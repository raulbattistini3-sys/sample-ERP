// Fuzzy word matching on top of the inverted text index (text-index.js).
//
// Each query word decides how it matches, in this order (resolveWord):
//   1. prefix   some index term starts with the word: exactly what `prefix` search does, score 1
//   2. fuzzy    no term does (a typo, a missing accent): find similar terms, as a vector search over
//               character trigrams, then verify and score them with edit distances
//   3. split    the word is several words typed without spaces ("pelculavidro" → película + vidro):
//               segment.js splits it into pieces that each match (prefix or fuzzy). Splits compete with
//               the fuzzy match on score; the winner must have products holding all of its pieces
//   4. partial  nothing above works: the longest start of the word (≥ MIN_PARTIAL letters) that matches,
//               ranked below everything else ("at least the first word they meant")
//   5. none     nothing close enough; the whole query matches nothing (words are AND-ed)
//
// The vector search: every distinct term (accents folded) is a sparse binary vector of its trigrams,
// stored as an inverted list trigram → term ids (CSR in typed arrays, like the text index). A query word
// becomes the trigrams of "  word" (end left open, since the user may still be typing); walking their
// lists counts, per term, the trigrams it shares with the query. Terms holding enough of the query's
// trigrams (containment = shared / query trigrams) are the candidates, best first. That is the cheap
// recall step; each candidate is then checked with the optimal string alignment distance against the
// closest start of the term (prefixOsa, ≤ maxEditsFor(length) edits) and scored:
//
//   score = 0.5 · (1 − d / (maxEdits + 1)) + 0.3 · JaroWinkler(word, term start) + 0.2 · containment
//
// so an exact prefix (1.0) outranks one edit, which outranks two; Jaro–Winkler breaks ties in favour of
// a shared beginning, and containment in favour of more of the word being present. Rows are ranked by
// the mean of their words' best scores.

import { fold, jaroWinkler, maxEditsFor, prefixOsa, trigrams } from "./similarity.js";
import { tokenize } from "./text-index.js";
import { MIN_FUZZY_PIECE, PIECE_PENALTY, segmentWord } from "./segment.js";

/** @typedef {import("./text-index.js").TextIndex} TextIndex */

/**
 * @typedef {object} TrigramIndex
 * @property {string[]} folded the text index's terms with accents folded, same ids
 * @property {Map<string, number>} gramIds trigram → id
 * @property {Uint32Array} offsets gramIds.size + 1; terms of trigram g are [offsets[g], offsets[g+1])
 * @property {Uint32Array} postings term ids
 * @property {Uint16Array} termGrams trigram count of each term
 * @property {number} bytes
 * @property {number} buildMs
 */

const MIN_CONTAINMENT = 0.25;
const MAX_CANDIDATES = 256;
const SUGGESTIONS = 3;
// partial matches: at least this many letters of the word's start, scored this much lower
const MIN_PARTIAL = 4;
const PARTIAL_PENALTY = 0.6;

/**
 * @param {TextIndex} index
 * @returns {TrigramIndex}
 */
export function buildTrigramIndex(index) {
  const t0 = performance.now();
  const { terms } = index;
  const folded = terms.map(fold);
  /** @type {Map<string, number>} */
  const gramIds = new Map();
  /** @type {number[]} */
  const counts = [];
  const termGrams = new Uint16Array(terms.length);
  let pairs = new Uint32Array(1 << 20);
  let np = 0;
  for (let t = 0; t < folded.length; t++) {
    // numbers ("128gb" stays, "500" goes): a typo'd number is a different number, never fuzzy-matched
    if (/^\d+$/.test(folded[t])) continue;
    const grams = trigrams(folded[t]);
    termGrams[t] = grams.length;
    for (const g of grams) {
      let id = gramIds.get(g);
      if (id === undefined) {
        id = gramIds.size;
        gramIds.set(g, id);
        counts.push(0);
      }
      if (np + 2 > pairs.length) {
        const bigger = new Uint32Array(pairs.length * 2);
        bigger.set(pairs);
        pairs = bigger;
      }
      pairs[np++] = id;
      pairs[np++] = t;
      counts[id]++;
    }
  }
  const offsets = new Uint32Array(gramIds.size + 1);
  for (let g = 0; g < counts.length; g++) offsets[g + 1] = offsets[g] + counts[g];
  const postings = new Uint32Array(offsets[gramIds.size]);
  const cursor = offsets.slice(0, gramIds.size);
  for (let p = 0; p < np; p += 2) postings[cursor[pairs[p]]++] = pairs[p + 1];
  let foldedBytes = 0;
  for (const f of folded) foldedBytes += 16 + f.length * 2;
  return {
    folded,
    gramIds,
    offsets,
    postings,
    termGrams,
    bytes: offsets.byteLength + postings.byteLength + termGrams.byteLength + foldedBytes + gramIds.size * 40,
    buildMs: performance.now() - t0,
  };
}

/**
 * How one query word matched, for the UI ("did you mean") and telemetry.
 * @typedef {object} WordMatch
 * @property {string} word
 * @property {"prefix" | "fuzzy" | "split" | "partial" | "none"} mode
 * @property {{ term: string, distance: number, score: number }[]} suggestions best fuzzy terms (empty for
 *   prefix); for split and partial, one entry: what the word was read as ("película vidro", "película…")
 * @property {string[]} [pieces] split and partial: the parts of the word that matched
 */

/**
 * First index with terms[i] >= key.
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

// per-term shared-trigram counters, reused across calls (one search at a time per thread)
let shared = new Uint16Array(0);

/**
 * The terms a word matches, with a score each.
 * @param {TextIndex} index
 * @param {TrigramIndex} tri
 * @param {string} word lowercased
 * @returns {{ mode: "prefix" | "fuzzy" | "none", terms: number[], scores: number[], suggestions: WordMatch["suggestions"] }}
 */
export function matchWord(index, tri, word) {
  const { terms } = index;
  const from = lowerBound(terms, word);
  const to = lowerBound(terms, word + "￿");
  if (to > from) {
    const ids = [];
    for (let t = from; t < to; t++) ids.push(t);
    return { mode: "prefix", terms: ids, scores: ids.map(() => 1), suggestions: [] };
  }

  const q = fold(word);
  const maxEdits = maxEditsFor(q.length);
  if (maxEdits === 0 || /^\d+$/.test(q)) return { mode: "none", terms: [], scores: [], suggestions: [] };

  // recall: shared trigrams per term, through the inverted lists
  if (shared.length < terms.length) shared = new Uint16Array(terms.length);
  const grams = trigrams(q, true);
  /** @type {number[]} */
  const touched = [];
  for (const g of grams) {
    const id = tri.gramIds.get(g);
    if (id === undefined) continue;
    for (let p = tri.offsets[id], end = tri.offsets[id + 1]; p < end; p++) {
      const t = tri.postings[p];
      if (shared[t]++ === 0) touched.push(t);
    }
  }
  /** @type {{ t: number, containment: number }[]} */
  let candidates = [];
  for (const t of touched) {
    const containment = shared[t] / grams.length;
    shared[t] = 0;
    if (containment >= MIN_CONTAINMENT) candidates.push({ t, containment });
  }
  candidates.sort((a, b) => b.containment - a.containment || a.t - b.t);
  if (candidates.length > MAX_CANDIDATES) candidates = candidates.slice(0, MAX_CANDIDATES);

  // verification and scoring
  /** @type {{ t: number, distance: number, score: number }[]} */
  const hits = [];
  for (const { t, containment } of candidates) {
    const f = tri.folded[t];
    const distance = prefixOsa(q, f, maxEdits);
    if (distance > maxEdits) continue;
    const start = f.slice(0, Math.min(f.length, q.length + distance));
    const score = 0.5 * (1 - distance / (maxEdits + 1)) + 0.3 * jaroWinkler(q, start) + 0.2 * containment;
    hits.push({ t, distance, score });
  }
  if (hits.length === 0) return { mode: "none", terms: [], scores: [], suggestions: [] };
  hits.sort((a, b) => b.score - a.score || a.t - b.t);
  return {
    mode: "fuzzy",
    terms: hits.map((h) => h.t),
    scores: hits.map((h) => h.score),
    suggestions: hits.slice(0, SUGGESTIONS).map((h) => ({ term: terms[h.t], distance: h.distance, score: Math.round(h.score * 1000) / 1000 })),
  };
}

/**
 * One AND-ed condition: the code must hold one of these terms (best score counts).
 * @typedef {{ terms: number[], scores: number[] }} Unit
 */

/**
 * @typedef {ReturnType<typeof matchWord> & import("./segment.js").PieceMatch} Piece
 */

/**
 * matchWord for a piece of a word, plus what segment.js needs to compare pieces.
 * @param {TextIndex} index
 * @param {TrigramIndex} tri
 * @param {string} piece
 * @returns {Piece}
 */
function matchPiece(index, tri, piece) {
  const m = matchWord(index, tri, piece);
  if (m.mode === "prefix") {
    // terms are sorted, so the first one starting with the piece is the piece itself when it is a word
    const first = index.terms[m.terms[0]];
    const quality = first === piece ? 1 : 0.7 + (0.3 * piece.length) / first.length;
    return { ...m, quality, label: piece, distance: 0 };
  }
  if (m.mode === "fuzzy") return { ...m, quality: m.scores[0], label: m.suggestions[0].term, distance: m.suggestions[0].distance };
  return { ...m, quality: 0, label: piece, distance: 0 };
}

/**
 * Whether some code is reached by every unit (their products intersect).
 * @param {TextIndex} index
 * @param {Unit[]} units at most 255
 * @param {number} codeCount
 */
function cooccur(index, units, codeCount) {
  const { offsets, postings } = index;
  // mark[c] = how many units in a row reached c
  const mark = new Uint8Array(codeCount);
  for (let u = 0; u < units.length; u++) {
    let any = false;
    for (const t of units[u].terms) {
      for (let p = offsets[t], end = offsets[t + 1]; p < end; p++) {
        const c = postings[p];
        if (mark[c] === u) {
          mark[c] = u + 1;
          any = true;
        }
      }
    }
    if (!any) return false;
  }
  return true;
}

/**
 * How one query word matches (steps 1–5 at the top): what to report, and the conditions it adds.
 * @param {TextIndex} index
 * @param {TrigramIndex} tri
 * @param {string} word lowercased
 * @param {number} codeCount
 * @returns {{ summary: WordMatch, units: Unit[] }}
 */
export function resolveWord(index, tri, word, codeCount) {
  const whole = matchWord(index, tri, word);
  if (whole.mode === "prefix") return { summary: { word, mode: "prefix", suggestions: [] }, units: [whole] };

  /** @type {Map<string, Piece>} */
  const memo = new Map();
  const piece = (/** @type {string} */ s) => {
    let m = memo.get(s);
    if (!m) memo.set(s, (m = matchPiece(index, tri, s)));
    return m;
  };

  // the fuzzy match of the whole word and the best splits, highest score first
  /** @type {{ score: number, units: Unit[], summary: WordMatch }[]} */
  const options = [];
  if (whole.mode === "fuzzy") options.push({ score: whole.scores[0], units: [whole], summary: { word, mode: "fuzzy", suggestions: whole.suggestions } });
  for (const split of segmentWord(fold(word), piece)) {
    // a split's rows rank below a whole-word match of the same quality
    const factor = PIECE_PENALTY ** (split.pieces.length - 1);
    options.push({
      score: split.score,
      units: split.matches.map((m) => ({ terms: m.terms, scores: m.scores.map((s) => s * factor) })),
      summary: {
        word,
        mode: "split",
        pieces: split.pieces,
        suggestions: [{ term: split.label, distance: split.distance, score: Math.round(split.score * 1000) / 1000 }],
      },
    });
  }
  options.sort((a, b) => b.score - a.score);
  // a split whose pieces never appear in the same product would find nothing: take the next one
  for (const o of options) if (o.units.length === 1 || cooccur(index, o.units, codeCount)) return o;

  // partial: the longest start of the word that matches on its own
  const q = fold(word);
  for (let len = q.length - 1; len >= MIN_PARTIAL; len--) {
    const start = q.slice(0, len);
    const m = piece(start);
    if (m.mode === "prefix" || (m.mode === "fuzzy" && len >= MIN_FUZZY_PIECE)) {
      return {
        summary: {
          word,
          mode: "partial",
          pieces: [start],
          suggestions: [{ term: `${m.label}…`, distance: m.distance, score: Math.round(m.quality * PARTIAL_PENALTY * 1000) / 1000 }],
        },
        units: [{ terms: m.terms, scores: m.scores.map((s) => s * PARTIAL_PENALTY) }],
      };
    }
  }
  return { summary: { word, mode: "none", suggestions: whole.suggestions }, units: [] };
}

/**
 * Marks and scores the dictionary codes matching every word of the query.
 *
 * @param {TextIndex} index
 * @param {TrigramIndex} tri
 * @param {number} codeCount
 * @param {string} query lowercased
 * @returns {{ mask: Uint8Array, score: Float32Array, words: WordMatch[], fuzzy: boolean }}
 *   `score` is the mean of the conditions' best scores for matching codes; `fuzzy` is true when any word
 *   wasn't a plain word start (then ranking by score is worth it; otherwise every match scores 1)
 */
export function fuzzyMatchCodes(index, tri, codeCount, query) {
  const words = [...new Set(tokenize(query))];
  const mask = new Uint8Array(codeCount);
  const score = new Float32Array(codeCount);
  if (words.length === 0) return { mask: mask.fill(1), score: score.fill(1), words: [], fuzzy: false };

  // each word adds one condition, or several when it was split into pieces; all are AND-ed
  /** @type {Unit[]} */
  const units = [];
  /** @type {WordMatch[]} */
  const summary = [];
  let fuzzy = false;
  for (const word of words) {
    const r = resolveWord(index, tri, word, codeCount);
    summary.push(r.summary);
    if (r.summary.mode === "none") return { mask, score, words: summary, fuzzy };
    if (r.summary.mode !== "prefix") fuzzy = true;
    units.push(...r.units);
  }

  const hits = new Uint8Array(codeCount);
  const seen = new Uint16Array(codeCount);
  const best = new Float32Array(codeCount);
  const total = new Float32Array(codeCount);
  const { offsets, postings } = index;
  for (let w = 0; w < units.length; w++) {
    const m = units[w];
    const stamp = w + 1;
    /** @type {number[]} */
    const reached = [];
    for (let k = 0; k < m.terms.length; k++) {
      const t = m.terms[k];
      const s = m.scores[k];
      for (let p = offsets[t], end = offsets[t + 1]; p < end; p++) {
        const c = postings[p];
        if (seen[c] !== stamp) {
          seen[c] = stamp;
          best[c] = s;
          reached.push(c);
        } else if (s > best[c]) best[c] = s;
      }
    }
    for (const c of reached) {
      hits[c]++;
      total[c] += best[c];
    }
  }
  for (let c = 0; c < codeCount; c++) {
    if (hits[c] === units.length) {
      mask[c] = 1;
      score[c] = total[c] / units.length;
    }
  }
  return { mask, score, words: summary, fuzzy };
}
