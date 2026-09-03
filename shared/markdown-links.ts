/**
 * Walk markdown links `[text](url)` in a string, calling `visitor` for each.
 * The visitor receives (text, url) and returns the replacement string,
 * or null to leave the link unchanged.
 * Image links `![…](…)` are always skipped.
 *
 * Iterative (not regex) so a `[` followed by many newlines and a `]` that is
 * not a link — a Python list of ASCII art, for example — cannot ReDoS.
 */
export function walkLinks(
  s: string,
  visitor: (text: string, url: string) => string | null,
): string {
  const result: string[] = []
  let pos = 0

  while (pos < s.length) {
    const idx = s.indexOf('[', pos)
    if (idx === -1) {
      result.push(s.slice(pos))
      break
    }

    // Skip image links ![...](...) — they're fine as-is
    if (idx > 0 && s[idx - 1] === '!') {
      result.push(s.slice(pos, idx + 1))
      pos = idx + 1
      continue
    }

    // Find the matching `]` accounting for nesting depth
    let depth = 1
    let end = idx + 1
    while (end < s.length && depth > 0) {
      if (s[end] === '[') depth++
      else if (s[end] === ']') depth--
      if (depth > 0) end++
    }

    if (depth !== 0) {
      result.push(s.slice(pos, idx + 1))
      pos = idx + 1
      continue
    }

    // end points to the closing `]` — check if followed by `(url)`
    if (end + 1 < s.length && s[end + 1] === '(') {
      const urlStart = end + 2
      const urlEnd = s.indexOf(')', urlStart)
      if (urlEnd !== -1) {
        const text = s.slice(idx + 1, end)
        const url = s.slice(urlStart, urlEnd)
        const replacement = visitor(text, url)
        if (replacement !== null) {
          result.push(s.slice(pos, idx))
          result.push(replacement)
          pos = urlEnd + 1
          continue
        }
      }
    }

    // Not a link or visitor declined — emit up to and including `[`
    result.push(s.slice(pos, idx + 1))
    pos = idx + 1
  }

  return result.join('')
}

/**
 * Collapse markdown links whose label spans several lines into a single line.
 * Replaces the previous regex which backtracked into InternalError / ReDoS on
 * a `[` that never formed a link (Reddit posts with indented Python lists).
 */
export function collapseMultilineLinks(s: string): string {
  if (!s.includes('\n') || !s.includes('[')) return s
  return walkLinks(s, (text, url) => {
    if (!text.includes('\n')) return null
    return `[${text.replace(/\s*\n\s*/g, ' ').trim()}](${url})`
  })
}
