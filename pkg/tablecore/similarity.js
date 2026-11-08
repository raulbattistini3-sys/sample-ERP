// String similarity measures for fuzzy search. All work on JS strings (UTF-16 code units), which is
// fine for the Latin text they see here; callers lowercase and fold accents first (see `fold`).
//
//   levenshtein      insertions, deletions, substitutions
//   osa              the same plus swapping two adjacent letters ("tecaldo" → "teclado" is 1)
//   prefixOsa        osa between a query and the best-matching *start* of a word, for search-as-you-type
//                    ("tecal" is 1 edit from "tecla…")
//   jaroWinkler      0..1, rewards a shared prefix; good at ranking short words
//   trigrams/cosine  a word as a sparse vector of character trigrams, compared by cosine or containment
//
// The distances take a `max` and stop early once it is exceeded, returning max + 1: the search only
// needs to know "within k edits or not", and the band keeps each check O(k · length).

/**
 * Lowercase, then strip combining marks: "Eletrônico" → "eletronico".
 * @param {string} s
 */
export function fold(s) {
  return s.toLowerCase().normalize("NFD").replace(/\p{M}+/gu, "");
}

// reused DP rows; grown on demand, never shrunk
let rowA = new Int32Array(64);
let rowB = new Int32Array(64);
let rowC = new Int32Array(64);
/** @param {number} n */
function rows(n) {
  if (rowA.length < n) {
    rowA = new Int32Array(n * 2);
    rowB = new Int32Array(n * 2);
    rowC = new Int32Array(n * 2);
  }
}

/**
 * Levenshtein distance, or max + 1 once it is certain to exceed max.
 * @param {string} a
 * @param {string} b
 * @param {number} [max]
 */
export function levenshtein(a, b, max = Infinity) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const n = b.length;
  rows(n + 1);
  let prev = rowA;
  let cur = rowB;
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    let rowMin = i;
    const ca = a.charCodeAt(i - 1);
    for (let j = 1; j <= n; j++) {
      const cost = ca === b.charCodeAt(j - 1) ? 0 : 1;
      const v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      cur[j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    const t = prev;
    prev = cur;
    cur = t;
  }
  return Math.min(prev[n], max + 1);
}

/**
 * Optimal string alignment distance (restricted Damerau–Levenshtein): Levenshtein plus adjacent
 * transpositions at cost 1. With `prefix`, `b` may be cut anywhere: the distance from `a` to the
 * closest start of `b`.
 *
 * @param {string} a the query word
 * @param {string} b the candidate
 * @param {number} [max]
 * @param {boolean} [prefix]
 */
export function osa(a, b, max = Infinity, prefix = false) {
  const m = a.length;
  // past m + max letters a prefix match can't get better, so don't look at them
  const n = prefix ? Math.min(b.length, m + (Number.isFinite(max) ? max : b.length)) : b.length;
  if (!prefix && Math.abs(m - n) > max) return max + 1;
  rows(n + 1);
  let prev2 = rowC; // row i - 2
  let prev = rowA; // row i - 1
  let cur = rowB;
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    cur[0] = i;
    let rowMin = i;
    const ca = a.charCodeAt(i - 1);
    for (let j = 1; j <= n; j++) {
      const cb = b.charCodeAt(j - 1);
      const cost = ca === cb ? 0 : 1;
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (i > 1 && j > 1 && ca === b.charCodeAt(j - 2) && a.charCodeAt(i - 2) === cb) v = Math.min(v, prev2[j - 2] + 1);
      cur[j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    const t = prev2;
    prev2 = prev;
    prev = cur;
    cur = t;
  }
  let d = prev[n];
  if (prefix) for (let j = 0; j < n; j++) if (prev[j] < d) d = prev[j];
  return Math.min(d, max + 1);
}

/**
 * osa against the closest start of `b`.
 * @param {string} a
 * @param {string} b
 * @param {number} [max]
 */
export const prefixOsa = (a, b, max = Infinity) => osa(a, b, max, true);

/**
 * Jaro–Winkler similarity, 0..1 (1 = equal). The Winkler bonus rewards up to 4 shared leading letters.
 * @param {string} a
 * @param {string} b
 */
export function jaroWinkler(a, b) {
  if (a === b) return 1;
  const la = a.length;
  const lb = b.length;
  if (la === 0 || lb === 0) return 0;
  const window = Math.max(0, Math.floor(Math.max(la, lb) / 2) - 1);
  const ma = new Uint8Array(la);
  const mb = new Uint8Array(lb);
  let matches = 0;
  for (let i = 0; i < la; i++) {
    const from = Math.max(0, i - window);
    const to = Math.min(lb - 1, i + window);
    for (let j = from; j <= to; j++) {
      if (mb[j] || a.charCodeAt(i) !== b.charCodeAt(j)) continue;
      ma[i] = mb[j] = 1;
      matches++;
      break;
    }
  }
  if (matches === 0) return 0;
  let t = 0;
  for (let i = 0, j = 0; i < la; i++) {
    if (!ma[i]) continue;
    while (!mb[j]) j++;
    if (a.charCodeAt(i) !== b.charCodeAt(j)) t++;
    j++;
  }
  const jaro = (matches / la + matches / lb + (matches - t / 2) / matches) / 3;
  let p = 0;
  while (p < 4 && p < la && p < lb && a.charCodeAt(p) === b.charCodeAt(p)) p++;
  return jaro + p * 0.1 * (1 - jaro);
}

/**
 * The distinct character trigrams of a word, padded like pg_trgm: two spaces before, one after, so
 * the start of a word weighs more. `partial` leaves the end open, for a word still being typed.
 * @param {string} word
 * @param {boolean} [partial]
 * @returns {string[]}
 */
export function trigrams(word, partial = false) {
  const s = `  ${word}${partial ? "" : " "}`;
  const out = new Set();
  for (let i = 0; i + 3 <= s.length; i++) out.add(s.slice(i, i + 3));
  return [...out];
}

/**
 * Cosine similarity of two words as binary trigram vectors: |A ∩ B| / √(|A| · |B|).
 * @param {string} a
 * @param {string} b
 */
export function trigramCosine(a, b) {
  const ta = trigrams(a);
  const tb = new Set(trigrams(b));
  let both = 0;
  for (const g of ta) if (tb.has(g)) both++;
  return ta.length && tb.size ? both / Math.sqrt(ta.length * tb.size) : 0;
}

/**
 * Edits allowed for a word of this length, like Elasticsearch's "AUTO": none up to 2 letters (too many
 * words are 1 edit apart), 1 up to 5, then 2.
 * @param {number} length
 */
export const maxEditsFor = (length) => (length <= 2 ? 0 : length <= 5 ? 1 : 2);
