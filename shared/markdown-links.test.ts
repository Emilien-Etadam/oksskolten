import { describe, it, expect } from 'vitest'
import { collapseMultilineLinks, walkLinks } from './markdown-links'

describe('collapseMultilineLinks', () => {
  it('collapses a label that spans several lines', () => {
    const input = `[
GitHub CopilotWrite better code with AI


](https://github.com/features/copilot)`
    expect(collapseMultilineLinks(input)).toBe(
      '[GitHub CopilotWrite better code with AI](https://github.com/features/copilot)',
    )
  })

  it('leaves a Python list that is not a link unchanged, quickly', () => {
    const input = 'stages = [\n' + '              |   |\n'.repeat(80) + ']\n'
    const start = Date.now()
    expect(collapseMultilineLinks(input)).toBe(input)
    expect(Date.now() - start).toBeLessThan(500)
  })
})

describe('walkLinks', () => {
  it('skips image links', () => {
    const input = '![alt](https://example.com/img.jpg)'
    expect(walkLinks(input, () => 'X')).toBe(input)
  })
})
