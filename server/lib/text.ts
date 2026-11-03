/**
 * Unicode-safe text helpers for content sent to LLM APIs.
 *
 * JS strings are UTF-16: `slice`/`substring` count code units and can cut a
 * non-BMP character (emoji, rare CJK) in half, leaving a lone surrogate that
 * is not valid Unicode and makes some inference servers reject the request.
 */

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g

/** Truncate to at most `max` UTF-16 units, never splitting a surrogate pair. */
export function truncateChars(str: string, max: number): string {
  if (str.length <= max) return str
  let end = Math.max(0, max)
  const code = str.charCodeAt(end - 1)
  // Last kept unit is a high surrogate whose pair would be cut off: drop it
  if (code >= 0xd800 && code <= 0xdbff) end -= 1
  return str.slice(0, end)
}

/** Replace any lone surrogate with U+FFFD so the string is valid Unicode. */
export function toWellFormedText(str: string): string {
  const fn = (String.prototype as { toWellFormed?: () => string }).toWellFormed
  if (typeof fn === 'function') return fn.call(str)
  return str.replace(LONE_SURROGATE, '�')
}

/** Recursively apply `toWellFormedText` to every string in plain objects/arrays. */
export function toWellFormedDeep<T>(value: T): T {
  if (typeof value === 'string') return toWellFormedText(value) as T
  if (Array.isArray(value)) return value.map(v => toWellFormedDeep(v)) as T
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value)) out[k] = toWellFormedDeep(v)
    return out as T
  }
  return value
}
