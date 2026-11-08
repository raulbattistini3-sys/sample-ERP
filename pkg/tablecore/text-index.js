// Inverted index over a dictionary column: term → dictionary codes.
//
// This is the "build an index or scan" trade a database makes, done on the
// client. `contains` scans every distinct string on every query (no build
// cost, O(distinct · |q|) per query). `token`/`prefix` pay once to tokenise
// and index (time + memory), then answer with binary searches and a walk over
// the posting lists, with no string work per query.
//
// Layout is CSR (compressed sparse row) in typed arrays rather than a
// Map<string, number[]>. 600k names give ~2M postings: as JS arrays that is
// millions of heap objects for the GC to trace; as one Uint32Array it is a
// single allocation the GC never looks inside.
//
//   terms     string[]     sorted, unique (plain code-unit order, so a prefix is a contiguous range)
//   offsets   Uint32Array  terms.length + 1; postings of term t are [offsets[t], offsets[t+1])
//   postings  Uint32Array  dictionary codes, ascending within each term

/**
 * @typedef {object} TextIndex
 * @property {string[]} terms
 * @property {Uint32Array} offsets
 * @property {Uint32Array} postings
 * @property {number} bytes typed-array bytes plus an estimate for the term strings
 * @property {number} buildMs
 */

const SPLIT = /[^\p{L}\p{N}]+/u;

/**
 * Splits a lowercased string into index terms.
 * @param {string} s
 * @returns {string[]}
 */
export function tokenize(s) {
  return s.split(SPLIT).filter(Boolean);
}

/**
 * @param {string[]} lower lowercased dictionary strings, indexed by code
 * @returns {TextIndex}
 */
export function buildTextIndex(lower) {
  const t0 = performance.now();
  // Pass 1: term → id, and the number of postings per term.
  /** @type {Map<string, number>} */
  const ids = new Map();
  /** @type {number[]} */
  let counts = [];
  // Flat (code, termId) pairs, kept in a growable typed buffer, not an array of pairs.
  let pairs = new Uint32Array(1 << 20);
  let np = 0;
  for (let code = 0; code < lower.length; code++) {
    const toks = tokenize(lower[code]);
    for (let k = 0; k < toks.length; k++) {
      let id = ids.get(toks[k]);
      if (id === undefined) {
        id = ids.size;
        ids.set(toks[k], id);
        counts.push(0);
      }
      // The same term twice in one string ("pro pro") is posted once.
      let dup = false;
      for (let j = 0; j < k; j++) if (toks[j] === toks[k]) dup = true;
      if (dup) continue;
      if (np + 2 > pairs.length) {
        const bigger = new Uint32Array(pairs.length * 2);
        bigger.set(pairs);
        pairs = bigger;
      }
      pairs[np++] = code;
      pairs[np++] = id;
      counts[id]++;
    }
  }

  // Sort terms; remap ids to sorted positions.
  const unsorted = [...ids.keys()];
  const order = unsorted.map((_, i) => i).sort((a, b) => (unsorted[a] < unsorted[b] ? -1 : unsorted[a] > unsorted[b] ? 1 : 0));
  const rank = new Uint32Array(order.length);
  for (let r = 0; r < order.length; r++) rank[order[r]] = r;
  const terms = order.map((i) => unsorted[i]);

  // Pass 2: prefix sums → offsets, then scatter. Codes were visited in
  // ascending order, so each posting list comes out sorted with no extra sort.
  const offsets = new Uint32Array(terms.length + 1);
  for (let id = 0; id < counts.length; id++) offsets[rank[id] + 1] = counts[id];
  for (let t = 0; t < terms.length; t++) offsets[t + 1] += offsets[t];
  const postings = new Uint32Array(offsets[terms.length]);
  const cursor = offsets.slice(0, terms.length);
  for (let p = 0; p < np; p += 2) postings[cursor[rank[pairs[p + 1]]]++] = pairs[p];
  counts = [];

  let termBytes = 0;
  for (const t of terms) termBytes += 16 + t.length * 2; // rough V8 string cost
  return { terms, offsets, postings, bytes: offsets.byteLength + postings.byteLength + termBytes, buildMs: performance.now() - t0 };
}

/**
 * First term index with terms[i] >= key.
 * @param {string[]} terms
 * @param {string} key
 */
function lowerBound(terms, key) {
  let lo = 0;
  let hi = terms.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (terms[mid] < key) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * Marks matching dictionary codes. Every query word must match (AND):
 * `token` needs an equal term, `prefix` a term that starts with the word.
 *
 * @param {TextIndex} index
 * @param {number} codeCount
 * @param {string} query lowercased
 * @param {"token" | "prefix"} mode
 * @returns {Uint8Array} 1 for codes that match
 */
export function matchCodes(index, codeCount, query, mode) {
  const words = [...new Set(tokenize(query))];
  const out = new Uint8Array(codeCount);
  if (words.length === 0) return out.fill(1);
  // hits[c] counts how many query words code c matched; seen[c] stamps the
  // word that last counted it, so a code reached through two terms of the same
  // word ("ssd" → "ssd", "ssds") counts once.
  const hits = new Uint8Array(codeCount);
  const seen = new Uint16Array(codeCount);
  const { terms, offsets, postings } = index;
  for (let w = 0; w < words.length; w++) {
    const word = words[w];
    const from = lowerBound(terms, word);
    const to = mode === "prefix" ? lowerBound(terms, word + "￿") : from < terms.length && terms[from] === word ? from + 1 : from;
    const stamp = w + 1;
    for (let t = from; t < to; t++) {
      for (let p = offsets[t], end = offsets[t + 1]; p < end; p++) {
        const c = postings[p];
        if (seen[c] !== stamp) {
          seen[c] = stamp;
          hits[c]++;
        }
      }
    }
  }
  for (let c = 0; c < codeCount; c++) if (hits[c] === words.length) out[c] = 1;
  return out;
}
