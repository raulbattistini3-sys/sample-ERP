import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_SEGMENT_LENGTH, segmentWord } from "../tablecore/segment.js";
import { fold, prefixOsa } from "../tablecore/similarity.js";

// segmentWord only needs a `match(piece)`: here a small word list, matched the way fuzzy.js does it
// (word start first, else within one edit of a word's start), so the split rules are tested on their own.
const WORDS = ["película", "vidro", "pele", "mouse", "sem", "fio", "teclado", "cabo", "usb", "geladeira", "frost", "free"].map(fold);

/** @param {string} piece */
function match(piece) {
  const starts = WORDS.filter((w) => w.startsWith(piece));
  if (starts.length) {
    const first = starts.sort()[0];
    return { mode: /** @type {const} */ ("prefix"), quality: first === piece ? 1 : 0.7 + (0.3 * piece.length) / first.length, label: piece, distance: 0 };
  }
  const near = WORDS.find((w) => prefixOsa(piece, w, 1) <= 1);
  if (near) return { mode: /** @type {const} */ ("fuzzy"), quality: 0.8, label: near, distance: 1 };
  return { mode: /** @type {const} */ ("none"), quality: 0, label: piece, distance: 0 };
}

test("a word typed without spaces splits into the words it holds", () => {
  assert.equal(segmentWord("mousesemfio", match)[0]?.label, "mouse sem fio");
  assert.equal(segmentWord("cabousb", match)[0]?.label, "cabo usb");
  assert.equal(segmentWord("geladeirafrostfree", match)[0]?.label, "geladeira frost free");
});

test("a typo inside one of the words still splits, and the label says what it was read as", () => {
  const [best] = segmentWord("pelculavidro", match);
  assert.deepEqual(best?.pieces, ["pelcula", "vidro"]);
  assert.equal(best?.label, "pelicula vidro");
  assert.equal(best?.distance, 1);
});

test("whole words beat word starts, and two pieces beat three", () => {
  const options = segmentWord("pelculavidro", match);
  // "pel|cula…" would need short word starts and a third piece: never ahead of película + vidro
  assert.ok(options.every((o, i) => i === 0 || o.score <= options[0].score));
  assert.equal(options[0]?.pieces.length, 2);
  const [twoWords] = segmentWord("cabousb", match);
  assert.equal(twoWords?.score, 0.9); // two whole words: 1 · PIECE_PENALTY
});

test("short typo'd pieces are never guessed, and unsplittable words give nothing", () => {
  // "cabx" is one edit from "cabo" but only 4 letters: not usable as a typo'd piece
  assert.deepEqual(segmentWord("cabxusb", match), []);
  assert.deepEqual(segmentWord("qqqqqqzzzz", match), []);
  assert.deepEqual(segmentWord("mouse", match), [], "shorter than two pieces");
  assert.deepEqual(segmentWord("mouse".repeat(5), match), [], `longer than ${MAX_SEGMENT_LENGTH} letters`);
});
