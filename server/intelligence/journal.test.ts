import { describe, it, expect } from 'vitest'
import { buildSectionPrompt, groupByTheme, remapCitations } from './journal.js'
import { buildImportanceQuestion } from '../ai/classify.js'
import type { JournalArticle } from './journal-db.js'

function article(id: number, theme: string | null): JournalArticle {
  return { id, title: `Title ${id}`, url: `https://x.example/${id}`, theme, feed_name: 'Feed', published_at: null, importance: null, body: 'Body' }
}

describe('groupByTheme', () => {
  it('follows the theme order and puts unthemed articles last', () => {
    const themes = [{ id: 'AI', label: 'AI' }, { id: 'DEV', label: 'Dev' }, { id: 'OTHER', label: 'Other' }]
    const buckets = groupByTheme([article(1, 'DEV'), article(2, null), article(3, 'AI'), article(4, 'OTHER'), article(5, 'GONE')], themes)
    expect(buckets.map(b => b.theme)).toEqual(['AI', 'DEV', '_'])
    expect(buckets[2].articles.map(a => a.id)).toEqual([2, 4, 5])
  })

  it('makes one bucket when there are no themes', () => {
    expect(groupByTheme([article(1, 'AI')], []).map(b => b.theme)).toEqual(['_'])
  })
})

describe('remapCitations', () => {
  it('maps local numbers, splits groups and drops unknown ones', () => {
    const map = new Map([[1, 7], [2, 8]])
    const { text, refs } = remapCitations('A [2]. B [1, 2, 9] .', n => map.get(n))
    expect(text).toBe('A [8]. B [7][8].')
    expect(refs).toEqual([8, 7])
  })
})

describe('buildSectionPrompt', () => {
  it('numbers articles and includes the reader feedback', () => {
    const prompt = buildSectionPrompt({
      label: 'AI',
      language: 'French',
      articles: [article(1, 'AI')],
      totalCount: 5,
      liked: ['Benchmarks'],
      disliked: ['Funding round'],
    })
    expect(prompt).toContain('[1] Title 1 (Feed)')
    expect(prompt).toContain('the 1 most relevant of 5')
    expect(prompt).toContain('- Benchmarks')
    expect(prompt).toContain('- Funding round')
    expect(prompt).toContain('Write it in French.')
  })
})

describe('buildImportanceQuestion', () => {
  it('includes the instruction and votes when there are some', () => {
    const q = buildImportanceQuestion({ instruction: 'Skip memes', liked: ['Benchmarks'], disliked: ['Funding'] })
    expect(q).toContain('Skip memes')
    expect(q).toContain('"Benchmarks"')
    expect(q).toContain('"Funding"')
  })

  it('is a plain question without context', () => {
    expect(buildImportanceQuestion(undefined)).toBe('How important is this article for this reader?')
  })
})
