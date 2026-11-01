import { describe, it, expect } from 'vitest'
import { truncateChars, toWellFormedText, toWellFormedDeep } from './text.js'

// Mirrors the "lone \ud83e" case: an emoji (🤖 = 🤖) cut in half
const EMOJI_TEXT = 'Hello 🤖'

// String.prototype.isWellFormed exists on Node 22 but not in the TS lib target
const isWellFormed = (s: string) => (s as unknown as { isWellFormed(): boolean }).isWellFormed()

describe('truncateChars', () => {
  it('never cuts inside a surrogate pair', () => {
    // 'Hello ' is 6 units, the emoji takes units 6-7: max 7 falls between them
    const out = truncateChars(EMOJI_TEXT, 7)
    expect(out).toBe('Hello ')
    expect(isWellFormed(out)).toBe(true)
    expect(JSON.stringify(out)).not.toMatch(/\\ud8/i)
  })

  it('keeps a whole emoji when it fits', () => {
    expect(truncateChars(EMOJI_TEXT, 8)).toBe(EMOJI_TEXT)
    expect(truncateChars(EMOJI_TEXT + '!', 8)).toBe(EMOJI_TEXT)
  })

  it('behaves like slice for plain text', () => {
    expect(truncateChars('abcdef', 3)).toBe('abc')
    expect(truncateChars('abc', 10)).toBe('abc')
    expect(truncateChars('abc', 0)).toBe('')
  })
})

describe('toWellFormedText', () => {
  it('replaces lone surrogates with U+FFFD', () => {
    const broken = EMOJI_TEXT.slice(0, 7)
    expect(isWellFormed(broken)).toBe(false)
    expect(toWellFormedText(broken)).toBe('Hello �')
    expect(toWellFormedText('\udd16x')).toBe('�x')
    expect(toWellFormedText(EMOJI_TEXT)).toBe(EMOJI_TEXT)
  })

  it('works without String.prototype.toWellFormed (fallback)', () => {
    const proto = String.prototype as { toWellFormed?: unknown }
    const original = proto.toWellFormed
    delete proto.toWellFormed
    try {
      expect(toWellFormedText('a\ud83e')).toBe('a�')
      expect(toWellFormedText('\udd16b')).toBe('�b')
      expect(toWellFormedText(EMOJI_TEXT)).toBe(EMOJI_TEXT)
    } finally {
      proto.toWellFormed = original
    }
  })
})

describe('toWellFormedDeep', () => {
  it('sanitizes strings nested in messages', () => {
    const messages = [
      { role: 'user', content: 'x\ud83e' },
      { role: 'assistant', content: [{ type: 'tool_result', tool_use_id: 't', content: '\ud83e' }] },
    ]
    const out = toWellFormedDeep(messages)
    expect(JSON.stringify(out)).not.toMatch(/\\ud8/i)
    expect(out[0].content).toBe('x�')
  })
})
