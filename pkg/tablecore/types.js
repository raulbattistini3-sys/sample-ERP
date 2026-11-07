// Shared JSDoc types. Nothing runs here; other modules import these with
// `@typedef {import("./types.js").Dataset} Dataset`.

/**
 * How a column's values are stored.
 * - `f64`: Float64Array, null is NaN (money, timestamps as epoch ms)
 * - `i32`: Int32Array, null is INT32_MIN
 * - `u8`: Uint8Array, booleans as 0/1, null is 255
 * - `dict`: Int32Array of codes into a string dictionary, null is -1
 * @typedef {"f64" | "i32" | "u8" | "dict"} ColumnType
 */

/**
 * A slice of the file: byte offset from the start, length in elements.
 * @typedef {{ offset: number, length: number }} Span
 */

/**
 * @typedef {object} ColumnHeader
 * @property {string} name
 * @property {ColumnType} type
 * @property {Span} data
 * @property {{ bytes: Span, offsets: Span, count: number, sorted: boolean }} [dict]
 */

/**
 * @typedef {object} Header
 * @property {1} version
 * @property {number} rows
 * @property {ColumnHeader[]} columns
 * @property {Record<string, unknown>} [meta]
 */

/**
 * Strings stored once as UTF-8. Entry `i` is `bytes[offsets[i]..offsets[i+1]]`.
 * When `sorted` is true, code order equals collation order, so comparing two
 * codes compares the strings without decoding them.
 * @typedef {object} Dict
 * @property {Uint8Array} bytes
 * @property {Uint32Array} offsets count + 1 entries
 * @property {number} count
 * @property {boolean} sorted
 */

/**
 * @typedef {object} Column
 * @property {string} name
 * @property {ColumnType} type
 * @property {Float64Array | Int32Array | Uint8Array} values
 * @property {Dict} [dict]
 */

/**
 * A columnar table. Every typed array is a view on `buffer`, so the whole
 * dataset moves between threads as one ArrayBuffer (or SharedArrayBuffer).
 * @typedef {object} Dataset
 * @property {number} rows
 * @property {Column[]} columns
 * @property {Map<string, Column>} byName
 * @property {ArrayBuffer | SharedArrayBuffer} buffer
 * @property {Header} header
 */

/**
 * @typedef {object} Filter
 * @property {string} column
 * @property {"contains" | "eq" | "in" | "token" | "prefix" | "fuzzy" | "gte" | "lte" | "between"} op
 *   `in` takes a list of strings (facets) or, on a numeric column, of numbers. `contains` scans every distinct string;
 *   `token` (whole words) and `prefix` (word starts) use a per-thread inverted index; `fuzzy` is `prefix`
 *   with typo tolerance per word (similar terms by trigram vectors and edit distance, see fuzzy.js),
 *   and ranks the rows by how close they are when any word was guessed.
 * @property {string | number | boolean | [number, number] | string[] | number[]} value
 */

/**
 * `auto` compares dictionary codes (fast, needs a sorted dictionary) or numbers.
 * `locale` decodes strings and uses Intl.Collator, which is what a naive app does.
 * @typedef {"auto" | "locale"} Comparator
 */

/**
 * @typedef {object} SortKey
 * @property {string} column
 * @property {boolean} [desc]
 * @property {Comparator} [comparator]
 */

/**
 * One table operation: filter then sort the first `limit` rows.
 * @typedef {object} OpSpec
 * @property {number} [limit] Only the first `limit` rows take part; lets one file serve every data size.
 * @property {Filter[]} [filters]
 * @property {SortKey[]} [sort]
 */

/**
 * Cost class of a sort: decides which per-unit coefficient the model uses.
 * @typedef {"none" | "num" | "code" | "locale"} SortClass
 */

/**
 * @typedef {object} OpResult
 * @property {Uint32Array} indices Row indices after filtering and sorting.
 * @property {number} scanned Rows the filters looked at (limit × filters).
 * @property {number} matched Rows left after filtering.
 * @property {number} prepareMs One-off string decoding (cold cache only).
 * @property {number} prepared Strings decoded by that step; 0 when warm.
 * @property {number} filterMs
 * @property {number} sortMs
 * @property {number} sortUnits m · log2(m) · keys
 * @property {SortClass} sortClass
 * @property {MatchInfo | null} [match] how the words of a fuzzy filter matched; null without one
 */

/**
 * @typedef {object} MatchInfo
 * @property {string} column
 * @property {boolean} fuzzy true when at least one word was matched by similarity
 * @property {import("./fuzzy.js").WordMatch[]} words
 */

/** @typedef {"main" | "worker"} Target */
/** @typedef {"main" | "worker" | "fixed" | "adaptive"} Strategy */

/**
 * A telemetry event, the same shape as `event.Event` in the Go agent.
 * `ts` is `performance.now()` on the thread that emitted it.
 * @typedef {object} TelemetryEvent
 * @property {string} source
 * @property {string} type
 * @property {number} ts
 * @property {Record<string, unknown>} data
 */

export {};
