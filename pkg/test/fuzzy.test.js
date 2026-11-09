import { test } from "node:test";
import assert from "node:assert/strict";
import { fold, levenshtein, osa, prefixOsa, jaroWinkler, trigrams, trigramCosine, maxEditsFor } from "../tablecore/similarity.js";
import { encodeColumnar, openColumnar, dictString } from "../tablecore/columnar.js";
import { runOp } from "../tablecore/compute.js";

test("levenshtein and OSA: the textbook values, and the early exit past max", () => {
  assert.equal(levenshtein("kitten", "sitting"), 3);
  assert.equal(levenshtein("", "abc"), 3);
  assert.equal(levenshtein("flaw", "lawn"), 2);
  assert.equal(levenshtein("kitten", "sitting", 1), 2); // max + 1: "more than 1"
  // a swap of neighbours is 2 edits for Levenshtein, 1 for OSA
  assert.equal(levenshtein("ca", "ac"), 2);
  assert.equal(osa("ca", "ac"), 1);
  assert.equal(osa("tecaldo", "teclado"), 1);
  assert.equal(osa("abc", "abc"), 0);
});

test("prefixOsa measures against the closest start of the word", () => {
  assert.equal(prefixOsa("tecl", "teclado"), 0);
  assert.equal(prefixOsa("tecal", "teclado"), 1); // "tecla" with a swap
  assert.equal(prefixOsa("mous", "mouse"), 0);
  assert.equal(prefixOsa("mause", "mouse"), 1);
  assert.equal(prefixOsa("xyz", "teclado", 1), 2);
});

test("Jaro-Winkler, trigrams and cosine", () => {
  assert.ok(Math.abs(jaroWinkler("martha", "marhta") - 0.961) < 0.001);
  assert.ok(Math.abs(jaroWinkler("dwayne", "duane") - 0.84) < 0.001);
  assert.equal(jaroWinkler("abc", "abc"), 1);
  assert.equal(jaroWinkler("abc", "xyz"), 0);
  assert.deepEqual(trigrams("cat"), ["  c", " ca", "cat", "at "]);
  assert.deepEqual(trigrams("cat", true), ["  c", " ca", "cat"]);
  assert.equal(trigramCosine("teclado", "teclado"), 1);
  assert.ok(trigramCosine("teclado", "tecaldo") > trigramCosine("teclado", "monitor"));
});

test("fold strips accents; edits allowed grow with length", () => {
  assert.equal(fold("Eletrônico Ação"), "eletronico acao");
  assert.deepEqual([1, 2, 3, 5, 6, 12].map(maxEditsFor), [0, 0, 1, 1, 2, 2]);
});

function catalog() {
  const names = [
    "Teclado mecânico RGB",
    "Teclado sem fio",
    "Mouse sem fio",
    "Monitor 24 polegadas",
    "Cabo USB-C 1m",
    "Eletrônico genérico",
    "Notebook 15",
    null,
  ];
  const ds = openColumnar(encodeColumnar(names.length, [{ name: "name", type: "dict", strings: names, compare: false }]));
  const col = /** @type {any} */ (ds.byName.get("name"));
  const namesOf = (/** @type {Uint32Array} */ idx) => [...idx].map((r) => dictString(col.dict, col.values[r]));
  return { ds, namesOf };
}

test("fuzzy: a word with a word-start match behaves like prefix and keeps row order", () => {
  const { ds, namesOf } = catalog();
  const r = runOp(ds, { filters: [{ column: "name", op: "fuzzy", value: "tecl" }] });
  assert.deepEqual(namesOf(r.indices), ["Teclado mecânico RGB", "Teclado sem fio"]);
  assert.equal(r.match?.fuzzy, false);
  assert.equal(r.match?.words[0].mode, "prefix");
});

test("fuzzy: typos, swaps and missing accents still find the product", () => {
  const { ds, namesOf } = catalog();
  for (const [query, want] of [
    ["tecaldo", "Teclado"], // swapped letters
    ["mause", "Mouse sem fio"], // one substitution
    ["monitr", "Monitor 24 polegadas"], // one deletion
    ["eletronico", "Eletrônico genérico"], // no accent typed
  ]) {
    const r = runOp(ds, { filters: [{ column: "name", op: "fuzzy", value: query }] });
    const found = namesOf(r.indices);
    assert.ok(found.length > 0 && found.every((n) => n?.startsWith(want)), `${query} → ${found.join(", ")}`);
  }
});

test("fuzzy: every word must match, and a guessed word ranks exact matches first", () => {
  const { ds, namesOf } = catalog();
  // "sem" is a prefix match; "fiu" is a guess for "fio": both "sem fio" products, both found
  const both = runOp(ds, { filters: [{ column: "name", op: "fuzzy", value: "sem fiu" }] });
  assert.deepEqual(namesOf(both.indices).sort(), ["Mouse sem fio", "Teclado sem fio"]);
  assert.equal(both.match?.fuzzy, true);
  assert.equal(both.match?.words[1].suggestions[0].term, "fio");

  // nothing close: no rows, and the word says so
  const none = runOp(ds, { filters: [{ column: "name", op: "fuzzy", value: "teclado xqzwv" }] });
  assert.equal(none.indices.length, 0);
  assert.equal(none.match?.words[1].mode, "none");
});

test("fuzzy: short words and numbers are never guessed", () => {
  const { ds } = catalog();
  // "tx" (2 letters) and "25" (a number) have no word-start match and are too risky to guess
  assert.equal(runOp(ds, { filters: [{ column: "name", op: "fuzzy", value: "tx" }] }).indices.length, 0);
  assert.equal(runOp(ds, { filters: [{ column: "name", op: "fuzzy", value: "monitor 25" }] }).indices.length, 0);
  assert.equal(runOp(ds, { filters: [{ column: "name", op: "fuzzy", value: "monitor 24" }] }).indices.length, 1);
});

test("fuzzy: ranking puts the closest guess first", () => {
  const names = ["Cabo HDMI", "Caixa de som", "Cabide", "Cano PVC"];
  const ds = openColumnar(encodeColumnar(names.length, [{ name: "name", type: "dict", strings: names, compare: false }]));
  const col = /** @type {any} */ (ds.byName.get("name"));
  const r = runOp(ds, { filters: [{ column: "name", op: "fuzzy", value: "cabp" }] });
  const found = [...r.indices].map((i) => dictString(col.dict, col.values[i]));
  // "cabp" is one substitution from "cabo" and from the start of "cabide"; the shorter, closer term leads
  assert.equal(found[0], "Cabo HDMI");
  assert.ok(found.includes("Cabide"));
  assert.ok(!found.includes("Caixa de som"));
});

test("fuzzy: words typed without spaces are split into the words they hold", () => {
  const { ds, namesOf } = catalog();
  for (const [query, want, label] of /** @type {[string, string[], string][]} */ ([
    ["cabousb", ["Cabo USB-C 1m"], "cabo usb"],
    ["mousesemfio", ["Mouse sem fio"], "mouse sem fio"],
    ["tecladosemfio", ["Teclado sem fio"], "teclado sem fio"],
    // a typo inside one of the words too
    ["tecaldosemfio", ["Teclado sem fio"], "teclado sem fio"],
  ])) {
    const r = runOp(ds, { filters: [{ column: "name", op: "fuzzy", value: query }] });
    assert.deepEqual(namesOf(r.indices), want, query);
    assert.equal(r.match?.words[0].mode, "split", query);
    assert.equal(r.match?.words[0].suggestions[0].term, label, query);
    assert.equal(r.match?.fuzzy, true);
  }
  // with other words around it, each split piece is one more AND-ed condition
  const r = runOp(ds, { filters: [{ column: "name", op: "fuzzy", value: "semfio teclado" }] });
  assert.deepEqual(namesOf(r.indices), ["Teclado sem fio"]);
});

test("fuzzy: a plain typo stays a typo, not a split", () => {
  const { ds } = catalog();
  const r = runOp(ds, { filters: [{ column: "name", op: "fuzzy", value: "tecaldo" }] });
  assert.equal(r.match?.words[0].mode, "fuzzy");
});

test("fuzzy: a split whose words never share a product is skipped; the word's start still matches", () => {
  const { ds, namesOf } = catalog();
  // "mouse" and "monitor" are both words, but no product has both: the start of the query is used instead
  const r = runOp(ds, { filters: [{ column: "name", op: "fuzzy", value: "mousemonitor" }] });
  assert.equal(r.match?.words[0].mode, "partial");
  assert.equal(r.match?.words[0].suggestions[0].term, "mouse…");
  assert.deepEqual(namesOf(r.indices), ["Mouse sem fio"]);
  // and something that starts like no word at all still finds nothing
  assert.equal(runOp(ds, { filters: [{ column: "name", op: "fuzzy", value: "qqqqqqzzzz" }] }).indices.length, 0);
});
