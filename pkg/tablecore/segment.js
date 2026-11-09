// Word segmentation: a query word typed without its spaces ("pelculavidro", "cabousb", "mousesemfio")
// split into pieces that each match the catalog's words.
//
// It runs only for a word that has no word-start match of its own (fuzzy.js decides). Every split point
// is tried, with pieces of at least MIN_PIECE letters; a piece is matched the same way a whole query word
// is (prefix, else fuzzy, by the `match` function passed in), and a piece that matches nothing can itself
// be split once more, up to MAX_PIECES pieces. Each split is scored by how good its pieces are:
//
//   piece quality   whole term (the piece is a word of the catalog)       1
//                   start of a longer term ("vid" of "vidro")              0.7 + 0.3 · piece / term length
//                   typo'd term (fuzzy, at least MIN_FUZZY_PIECE letters)  its fuzzy score (≈ 0.6–0.95)
//   split score     mean quality · PIECE_PENALTY^(pieces − 1)
//
// so "pelcula|vidro" (a typo'd whole term + a whole term) beats "pel|cula|vidro" (three pieces, two of
// them only word starts), and two pieces beat three. The caller compares the best splits with matching the
// whole word fuzzily and keeps whichever scores higher and still finds products.
//
// Nothing here knows about indexes: `match` is injected, so the rules can be tested with a plain word list
// (test/segment.test.js).

export const MIN_PIECE = 3;
// typo'd pieces need more letters than exact ones: a 3–4 letter piece allowed one edit matches far too much
export const MIN_FUZZY_PIECE = 5;
export const MAX_PIECES = 3;
export const PIECE_PENALTY = 0.9;
// words longer than this are not split (each split point costs a match; 24 letters is already 3 words)
export const MAX_SEGMENT_LENGTH = 24;
const MAX_OPTIONS = 5;

/**
 * How one piece matched, as `match` reports it.
 * @typedef {object} PieceMatch
 * @property {"prefix" | "fuzzy" | "none"} mode
 * @property {number} quality 0..1, see the table above (0 when mode is "none")
 * @property {string} label what to show for it: the piece itself, or the term it was taken for
 * @property {number} distance edits (0 for prefix)
 */

/**
 * @template M
 * @typedef {object} Split
 * @property {string[]} pieces the substrings of the word, in order
 * @property {M[]} matches the `match` result of each piece
 * @property {string} label the pieces' labels joined by spaces ("película vidro")
 * @property {number} distance total edits
 * @property {number} score see the table above
 */

/**
 * The best ways to split `word`, best first; empty when none has every piece matching.
 *
 * @template {PieceMatch} M
 * @param {string} word lowercased, no spaces
 * @param {(piece: string) => M} match memoize it: the same pieces come up from different split points
 * @param {number} [maxPieces]
 * @returns {Split<M>[]}
 */
export function segmentWord(word, match, maxPieces = MAX_PIECES) {
  if (word.length < 2 * MIN_PIECE || word.length > MAX_SEGMENT_LENGTH || maxPieces < 2) return [];
  /** @type {Split<M>[]} */
  const options = [];
  for (let i = MIN_PIECE; i <= word.length - MIN_PIECE; i++) {
    const leftPiece = word.slice(0, i);
    const left = match(leftPiece);
    if (!usable(leftPiece, left)) continue;
    const rightPiece = word.slice(i);
    const right = match(rightPiece);
    if (usable(rightPiece, right)) options.push(make([leftPiece, rightPiece], [left, right]));
    else if (maxPieces > 2) {
      // the rest matches nothing as one piece: split it again (its best split only)
      const [rest] = segmentWord(rightPiece, match, maxPieces - 1);
      if (rest) options.push(make([leftPiece, ...rest.pieces], [left, ...rest.matches]));
    }
  }
  options.sort((a, b) => b.score - a.score || a.pieces.length - b.pieces.length);
  return options.slice(0, MAX_OPTIONS);
}

/**
 * @param {string} piece
 * @param {PieceMatch} m
 */
function usable(piece, m) {
  if (m.mode === "none") return false;
  return m.mode === "prefix" || piece.length >= MIN_FUZZY_PIECE;
}

/**
 * @template {PieceMatch} M
 * @param {string[]} pieces
 * @param {M[]} matches
 * @returns {Split<M>}
 */
function make(pieces, matches) {
  const mean = matches.reduce((s, m) => s + m.quality, 0) / matches.length;
  return {
    pieces,
    matches,
    label: matches.map((m) => m.label).join(" "),
    distance: matches.reduce((s, m) => s + m.distance, 0),
    score: mean * PIECE_PENALTY ** (pieces.length - 1),
  };
}
