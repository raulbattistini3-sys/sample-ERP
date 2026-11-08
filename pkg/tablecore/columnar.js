// Binary columnar format, read and written here so the converter, the page,
// the worker and the tests share one implementation.
//
// Layout: "TCC1" | u32 header length | header JSON (UTF-8) | padding to 8 |
// column buffers, each 8-byte aligned. Spans in the header are absolute
// offsets, so reading is just creating typed-array views: no parsing, no copy.

/** @typedef {import("./types.js").Header} Header */
/** @typedef {import("./types.js").ColumnHeader} ColumnHeader */
/** @typedef {import("./types.js").ColumnType} ColumnType */
/** @typedef {import("./types.js").Dataset} Dataset */
/** @typedef {import("./types.js").Column} Column */
/** @typedef {import("./types.js").Dict} Dict */

const MAGIC = 0x31434354; // "TCC1" little-endian
export const NULL_I32 = -2147483648;
export const NULL_U8 = 255;

/** @param {number} n */
const align8 = (n) => (n + 7) & ~7;

const decoder = new TextDecoder();

/**
 * TextDecoder refuses views over a SharedArrayBuffer, so shared bytes are
 * copied first. Only the decoded slice is copied, so a single cell stays cheap.
 *
 * @param {Uint8Array} bytes
 */
const decode = (bytes) =>
  decoder.decode(typeof SharedArrayBuffer !== "undefined" && bytes.buffer instanceof SharedArrayBuffer ? bytes.slice() : bytes);

/**
 * Opens a columnar buffer. The views share `buffer`; nothing is copied.
 *
 * @param {ArrayBuffer | SharedArrayBuffer} buffer
 * @returns {Dataset}
 */
export function openColumnar(buffer) {
  const dv = new DataView(buffer);
  if (dv.getUint32(0, true) !== MAGIC) throw new Error("not a TCC1 columnar file");
  const headerLen = dv.getUint32(4, true);
  /** @type {Header} */
  const header = JSON.parse(decode(new Uint8Array(buffer, 8, headerLen)));

  /** @type {Column[]} */
  const columns = header.columns.map((c) => {
    /** @type {Column} */
    const col = { name: c.name, type: c.type, values: view(buffer, c.type, c.data.offset, c.data.length) };
    if (c.dict) {
      col.dict = {
        bytes: new Uint8Array(buffer, c.dict.bytes.offset, c.dict.bytes.length),
        offsets: new Uint32Array(buffer, c.dict.offsets.offset, c.dict.offsets.length),
        count: c.dict.count,
        sorted: c.dict.sorted,
      };
    }
    return col;
  });

  return { rows: header.rows, columns, byName: new Map(columns.map((c) => [c.name, c])), buffer, header };
}

/**
 * @param {ArrayBuffer | SharedArrayBuffer} buffer
 * @param {ColumnType} type
 * @param {number} offset
 * @param {number} length
 */
function view(buffer, type, offset, length) {
  switch (type) {
    case "f64":
      return new Float64Array(buffer, offset, length);
    case "i32":
    case "dict":
      return new Int32Array(buffer, offset, length);
    case "u8":
      return new Uint8Array(buffer, offset, length);
  }
}

/**
 * A column to encode. For `dict`, pass `strings` (one per row, null allowed);
 * the dictionary is built and optionally sorted with `compare`.
 *
 * @typedef {object} ColumnInput
 * @property {string} name
 * @property {ColumnType} type
 * @property {ArrayLike<number>} [values] for f64 / i32 / u8
 * @property {(string | null)[]} [strings] for dict
 * @property {((a: string, b: string) => number) | false} [compare] dictionary order; false keeps first-seen order
 */

/**
 * Encodes columns into one ArrayBuffer in the TCC1 layout.
 *
 * @param {number} rows
 * @param {ColumnInput[]} inputs
 * @param {Record<string, unknown>} [meta]
 * @returns {ArrayBuffer}
 */
export function encodeColumnar(rows, inputs, meta) {
  const enc = new TextEncoder();
  /** @type {{ header: ColumnHeader, parts: { span: import("./types.js").Span, bytes: Uint8Array }[] }[]} */
  const planned = [];

  for (const input of inputs) {
    if (input.type !== "dict") {
      const values = input.values ?? [];
      if (values.length !== rows) throw new Error(`${input.name}: ${values.length} values, want ${rows}`);
      const typed =
        input.type === "f64" ? Float64Array.from(values) : input.type === "i32" ? Int32Array.from(values) : Uint8Array.from(values);
      const span = { offset: 0, length: rows };
      planned.push({ header: { name: input.name, type: input.type, data: span }, parts: [{ span, bytes: bytesOf(typed) }] });
      continue;
    }

    const strings = input.strings ?? [];
    if (strings.length !== rows) throw new Error(`${input.name}: ${strings.length} strings, want ${rows}`);
    const unique = [...new Set(strings.filter((s) => s !== null))];
    const sorted = input.compare !== false;
    if (sorted) unique.sort(input.compare || undefined);
    /** @type {Map<string, number>} */
    const code = new Map(unique.map((s, i) => [s, i]));

    const codes = new Int32Array(rows);
    for (let i = 0; i < rows; i++) {
      const s = strings[i];
      codes[i] = s === null ? -1 : /** @type {number} */ (code.get(s));
    }
    const encoded = unique.map((s) => enc.encode(s));
    const offsets = new Uint32Array(unique.length + 1);
    for (let i = 0; i < encoded.length; i++) offsets[i + 1] = offsets[i] + encoded[i].length;
    const dictBytes = new Uint8Array(offsets[unique.length]);
    for (let i = 0; i < encoded.length; i++) dictBytes.set(encoded[i], offsets[i]);

    const data = { offset: 0, length: rows };
    const bytes = { offset: 0, length: dictBytes.length };
    const offs = { offset: 0, length: offsets.length };
    planned.push({
      header: { name: input.name, type: "dict", data, dict: { bytes, offsets: offs, count: unique.length, sorted } },
      parts: [
        { span: data, bytes: bytesOf(codes) },
        { span: offs, bytes: bytesOf(offsets) },
        { span: bytes, bytes: dictBytes },
      ],
    });
  }

  // Header length depends on the offsets and the offsets on the header length,
  // so lay out twice: the second pass uses the real header size.
  /** @type {Header} */
  const header = { version: 1, rows, columns: planned.map((p) => p.header), meta };
  let headerBytes = enc.encode(JSON.stringify(header));
  for (let pass = 0; pass < 2; pass++) {
    let cursor = align8(8 + headerBytes.length + 64); // slack so offsets growing a digit can't overlap
    for (const p of planned) {
      for (const part of p.parts) {
        part.span.offset = cursor;
        cursor = align8(cursor + part.bytes.length);
      }
    }
    headerBytes = enc.encode(JSON.stringify(header));
  }

  const first = planned[0]?.parts[0];
  if (first && 8 + headerBytes.length > first.span.offset) throw new Error("header overlaps data; raise the slack");
  const last = planned.flatMap((p) => p.parts).at(-1);
  const total = last ? align8(last.span.offset + last.bytes.length) : align8(8 + headerBytes.length);
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, MAGIC, true);
  dv.setUint32(4, headerBytes.length, true);
  out.set(headerBytes, 8);
  for (const p of planned) for (const part of p.parts) out.set(part.bytes, part.span.offset);
  return out.buffer;
}

/** @param {ArrayBufferView} a */
const bytesOf = (a) => new Uint8Array(a.buffer, a.byteOffset, a.byteLength);

/**
 * Decodes one dictionary entry. Use for the visible rows only.
 *
 * @param {Dict} dict
 * @param {number} code
 * @returns {string | null}
 */
export function dictString(dict, code) {
  if (code < 0) return null;
  return decode(dict.bytes.subarray(dict.offsets[code], dict.offsets[code + 1]));
}

/** @type {WeakMap<Uint8Array, string[]>} */
const decodedCache = new WeakMap();

/**
 * Decodes every entry once per thread and caches it. Needed for `contains`
 * filters and the `locale` comparator; costs ~50–150 ms for 600k strings,
 * which the first such operation pays.
 *
 * @param {Dict} dict
 * @returns {string[]}
 */
export function dictStrings(dict) {
  let all = decodedCache.get(dict.bytes);
  if (!all) {
    // Shared: copy the whole string table once instead of once per entry.
    const bytes = typeof SharedArrayBuffer !== "undefined" && dict.bytes.buffer instanceof SharedArrayBuffer ? dict.bytes.slice() : dict.bytes;
    all = new Array(dict.count);
    for (let i = 0; i < dict.count; i++) all[i] = decoder.decode(bytes.subarray(dict.offsets[i], dict.offsets[i + 1]));
    decodedCache.set(dict.bytes, all);
  }
  return all;
}

/**
 * True when `dictStrings(dict)` would return from cache.
 *
 * @param {Dict} dict
 */
export function isDecoded(dict) {
  return decodedCache.has(dict.bytes);
}

/**
 * Formats one cell for display.
 *
 * @param {Column} col
 * @param {number} row
 * @returns {string}
 */
export function cellText(col, row) {
  const v = col.values[row];
  switch (col.type) {
    case "dict":
      return col.dict ? (dictString(col.dict, v) ?? "") : "";
    case "f64":
      return Number.isNaN(v) ? "" : col.name.startsWith("data") ? new Date(v).toISOString().slice(0, 19).replace("T", " ") : String(v);
    case "i32":
      return v === NULL_I32 ? "" : String(v);
    case "u8":
      return v === NULL_U8 ? "" : v ? "sim" : "não";
  }
}

/**
 * Copies a dataset into a SharedArrayBuffer so main thread and worker read
 * the same memory. Only works when the page is cross-origin isolated.
 *
 * @param {Dataset} ds
 * @returns {Dataset}
 */
export function toShared(ds) {
  const shared = new SharedArrayBuffer(ds.buffer.byteLength);
  new Uint8Array(shared).set(new Uint8Array(ds.buffer));
  return openColumnar(shared);
}
