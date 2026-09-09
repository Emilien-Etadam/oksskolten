import { describe, it, expect } from 'vitest'
import { parseSmartQuery, smartQuerySince } from './smart-query.js'

describe('parseSmartQuery', () => {
  it('keeps plain words as free text', () => {
    expect(parseSmartQuery('rust async runtime')).toEqual({ text: 'rust async runtime' })
  })

  it('parses filters and removes them from the text', () => {
    const q = parseSmartQuery('rust unread:true bookmarked:1 feed:12 category:3 sort:score')
    expect(q).toEqual({ text: 'rust', unread: true, bookmarked: true, feedId: 12, categoryId: 3, sort: 'score' })
  })

  it('understands is:… shortcuts', () => {
    expect(parseSmartQuery('is:unread is:liked')).toEqual({ text: '', unread: true, liked: true })
    expect(parseSmartQuery('is:read').unread).toBe(false)
  })

  it('parses @period shortcuts and since:', () => {
    expect(parseSmartQuery('@today').sinceDays).toBe(1)
    expect(parseSmartQuery('@week').sinceDays).toBe(7)
    expect(parseSmartQuery('since:2w').sinceDays).toBe(14)
    expect(parseSmartQuery('since:1m').sinceDays).toBe(30)
    expect(parseSmartQuery('since:5').sinceDays).toBe(5)
  })

  it('keeps quoted phrases and unknown key:value tokens as text', () => {
    const q = parseSmartQuery('"machine learning" unread:maybe http://x.y foo:bar')
    expect(q.text).toBe('machine learning unread:maybe http://x.y foo:bar')
    expect(q.unread).toBeUndefined()
  })

  it('ignores a lone @ or an unknown @period', () => {
    expect(parseSmartQuery('@ @decade').text).toBe('@ @decade')
  })
})

describe('smartQuerySince', () => {
  it('returns undefined without a window', () => {
    expect(smartQuerySince({ text: '' })).toBeUndefined()
  })

  it('starts today at local midnight for @today', () => {
    const now = new Date(2026, 4, 10, 15, 30)
    const since = new Date(smartQuerySince({ text: '', sinceDays: 1 }, now)!)
    expect(since.getFullYear()).toBe(2026)
    expect(since.getMonth()).toBe(4)
    expect(since.getDate()).toBe(10)
    expect(since.getHours()).toBe(0)
  })

  it('goes back N-1 days for larger windows', () => {
    const now = new Date(2026, 4, 10, 15, 30)
    const since = new Date(smartQuerySince({ text: '', sinceDays: 7 }, now)!)
    expect(since.getDate()).toBe(4)
  })
})
