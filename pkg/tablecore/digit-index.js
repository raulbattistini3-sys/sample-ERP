// Substring search over codes shaped "prefix + number" (LT-0000123, LT2-0300000, 123456789), without
// testing every string per query.
//
// Each string splits into a prefix and its trailing run of digits. Strings with the same prefix and the
// same number of digits form a group, and a group keeps its numbers sorted (Float64Array, exact up to 15
// digits) next to their dictionary codes. A query q found inside prefix + digits sits in one of three places:
//
//   1. inside the prefix              every string of the group matches
//   2. across the boundary            q = A + D, A a suffix of the prefix, D the first digits of the
//                                     number: one range of numbers, [D·10^(w-|D|), (D+1)·10^(w-|D|))
//   3. inside the digits (q digits)   at p digits from the right: n = a·10^(p+k) + q·10^p + b, b < 10^p,
//                                     one range per a. Over every p that is about N/10^k ranges, so the
//                                     work follows the number of matches, not the size of the group
//
// Each range is a binary search in the sorted numbers, then a walk. When the ranges would cost more than
// reading the group (short digit queries like "0" on wide numbers), the group is read instead, testing
// its strings one by one, which is what `contains` does without an index.
//
// The index only pays off when the column really has that shape: when too many strings have no
// trailing number, or there are too many groups, the build gives up and `contains` keeps scanning.

/**
 * @typedef {object} DigitGroup
 * @property {string} prefix lowercased
 * @property {number} width digits in the number
 * @property {Float64Array} nums ascending
 * @property {Uint32Array} codes dictionary code of nums[i]
 */

/**
 * @typedef {object} DigitIndex
 * @property {DigitGroup[]} groups
 * @property {Uint32Array} rest codes without a trailing number (or one too long to be exact), tested as strings
 * @property {number} bytes
 * @property {number} buildMs
 */

/** Up to this many digits a number is exact in a double (10^15 < 2^53). */
const MAX_WIDTH = 15;
/** More groups than this and the column isn't codes with a number (names, free text). */
export const MAX_GROUPS = 64;
/** More strings without a number than this share, likewise. */
const MAX_REST_SHARE = 0.1;

const POW10 = Array.from({ length: MAX_WIDTH + 2 }, (_, i) => 10 ** i);

/** @param {number} c */
const isDigit = (c) => c >= 48 && c <= 57;

/**
 * Builds the index, or returns null when the strings aren't shaped "prefix + number".
 *
 * @param {string[]} lower lowercased dictionary strings, indexed by code
 * @returns {DigitIndex | null}
 */
export function buildDigitIndex(lower) {
  const t0 = performance.now();
  const count = lower.length;
  const maxRest = Math.max(16, Math.floor(count * MAX_REST_SHARE));
  /** @type {Map<string, { prefix: string, width: number, nums: number[], codes: number[] }>} */
  const byKey = new Map();
  /** @type {number[]} */
  const rest = [];
  // Neighbouring codes usually share the group (a sorted dictionary lists them together): reuse it
  // without slicing the prefix or looking it up.
  /** @type {{ prefix: string, width: number, nums: number[], codes: number[] } | null} */
  let g = null;
  for (let code = 0; code < count; code++) {
    const s = lower[code];
    let i = s.length;
    let num = 0;
    let scale = 1;
    while (i > 0) {
      const ch = s.charCodeAt(i - 1);
      if (!isDigit(ch)) break;
      num += (ch - 48) * scale;
      scale *= 10;
      i--;
    }
    const width = s.length - i;
    if (width === 0 || width > MAX_WIDTH) {
      rest.push(code);
      if (rest.length > maxRest) return null;
      continue;
    }
    if (!g || g.width !== width || g.prefix.length !== i || !s.startsWith(g.prefix)) {
      const prefix = s.slice(0, i);
      /** @type {string} */
      const key = `${width}\u0000${prefix}`;
      g = byKey.get(key) ?? null;
      if (!g) {
        if (byKey.size >= MAX_GROUPS) return null;
        byKey.set(key, (g = { prefix, width, nums: [], codes: [] }));
      }
    }
    g.nums.push(num);
    g.codes.push(code);
  }

  let bytes = rest.length * 4;
  /** @type {DigitGroup[]} */
  const groups = [];
  for (const g of byKey.values()) {
    const n = g.nums.length;
    const nums = new Float64Array(n);
    const codes = new Uint32Array(n);
    let ascending = true;
    for (let j = 0; j < n; j++) {
      nums[j] = g.nums[j];
      codes[j] = g.codes[j];
      if (j > 0 && nums[j] < nums[j - 1]) ascending = false;
    }
    // A sorted dictionary already lists zero-padded numbers in order; sort only when it didn't.
    if (!ascending) {
      const order = new Uint32Array(n);
      for (let j = 0; j < n; j++) order[j] = j;
      order.sort((a, b) => g.nums[a] - g.nums[b]);
      for (let j = 0; j < n; j++) {
        nums[j] = g.nums[order[j]];
        codes[j] = g.codes[order[j]];
      }
    }
    groups.push({ prefix: g.prefix, width: g.width, nums, codes });
    bytes += n * 12;
  }
  return { groups, rest: Uint32Array.from(rest), bytes, buildMs: performance.now() - t0 };
}

/**
 * First j with nums[j] >= x.
 * @param {Float64Array} nums
 * @param {number} x
 * @param {number} lo
 */
function lowerBound(nums, x, lo) {
  let hi = nums.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (nums[mid] < x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * Marks the codes of a group whose number is in [lo, hi). `from` lets ascending ranges resume the search.
 * @param {DigitGroup} g
 * @param {Uint8Array} mask
 * @param {number} lo
 * @param {number} hi
 * @param {number} from
 * @returns {number} where the next, higher range can start searching
 */
function markRange(g, mask, lo, hi, from) {
  const { nums, codes } = g;
  let j = lowerBound(nums, lo, from);
  while (j < nums.length && nums[j] < hi) mask[codes[j++]] = 1;
  return j;
}

/**
 * Codes whose string contains `q`, as a mask over the dictionary (1 = match).
 *
 * @param {DigitIndex} index
 * @param {string[]} lower the lowercased strings the index was built from
 * @param {number} count dictionary size
 * @param {string} q lowercased query
 * @returns {Uint8Array}
 */
export function digitMatchCodes(index, lower, count, q) {
  const mask = new Uint8Array(count);
  for (let j = 0; j < index.rest.length; j++) {
    const c = index.rest[j];
    if (lower[c].includes(q)) mask[c] = 1;
  }
  if (q.length === 0) {
    mask.fill(1);
    return mask;
  }

  // The trailing digit run of q, and where it starts: a straddling match needs q = A + D with D all digits.
  let firstDigit = q.length;
  while (firstDigit > 0 && isDigit(q.charCodeAt(firstDigit - 1))) firstDigit--;
  const allDigits = firstDigit === 0;
  const k = q.length;

  for (const g of index.groups) {
    const n = g.nums.length;
    if (n === 0) continue;
    const w = g.width;

    // 1. inside the prefix: the whole group
    if (g.prefix.includes(q)) {
      for (let j = 0; j < n; j++) mask[g.codes[j]] = 1;
      continue;
    }

    // 2. across the boundary: A = q[0, i) a non-empty suffix of the prefix, D = q[i, k) the number's first digits
    for (let i = Math.max(1, firstDigit); i < k; i++) {
      const d = k - i;
      if (d > w || !g.prefix.endsWith(q.slice(0, i))) continue;
      const D = Number(q.slice(i));
      markRange(g, mask, D * POW10[w - d], (D + 1) * POW10[w - d], 0);
    }

    // 3. inside the digits
    if (!allDigits || k > w) continue;
    const Q = Number(q);
    const min = g.nums[0];
    const max = g.nums[n - 1];
    // ranges over every offset, against reading the group (log2 n steps per range)
    let ranges = 0;
    for (let p = 0; p <= w - k; p++) ranges += Math.floor(max / POW10[p + k]) - Math.floor(min / POW10[p + k]) + 1;
    if (ranges * Math.log2(n + 1) > n) {
      for (let j = 0; j < n; j++) {
        const c = g.codes[j];
        if (mask[c] === 0 && lower[c].includes(q)) mask[c] = 1;
      }
      continue;
    }
    for (let p = 0; p <= w - k; p++) {
      const block = POW10[p + k];
      const lo0 = Q * POW10[p];
      const span = POW10[p];
      let from = 0;
      for (let a = Math.floor(min / block), last = Math.floor(max / block); a <= last && from < n; a++) {
        const lo = a * block + lo0;
        from = markRange(g, mask, lo, lo + span, from);
      }
    }
  }
  return mask;
}
