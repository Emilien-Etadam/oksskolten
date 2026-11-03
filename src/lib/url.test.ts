import { describe, it, expect } from 'vitest'
import { extractDomain, isGithubStarsFeed } from './url'

describe('extractDomain', () => {
  it('extracts hostname from a standard URL', () => {
    expect(extractDomain('https://example.com/path')).toBe('example.com')
  })

  it('extracts hostname with subdomain', () => {
    expect(extractDomain('https://blog.example.com/post/1')).toBe('blog.example.com')
  })

  it('extracts hostname from http URL', () => {
    expect(extractDomain('http://example.org')).toBe('example.org')
  })

  it('returns null for invalid URL', () => {
    expect(extractDomain('not-a-url')).toBeNull()
  })

  it('returns null for empty string', () => {
    expect(extractDomain('')).toBeNull()
  })
})

describe('isGithubStarsFeed', () => {
  it('matches the canonical stars URL in rss_url, whatever was pasted', () => {
    expect(isGithubStarsFeed({ url: 'https://github.com/octocat?tab=stars', rss_url: 'https://github.com/stars/octocat' })).toBe(true)
    expect(isGithubStarsFeed({ url: 'https://github.com/stars/octocat', rss_url: null })).toBe(true)
  })

  it('rejects other GitHub feeds', () => {
    expect(isGithubStarsFeed({ url: 'https://github.com/octocat/hello', rss_url: 'https://github.com/octocat/hello/releases.atom' })).toBe(false)
    expect(isGithubStarsFeed({ url: 'https://github.com/trending', rss_url: null })).toBe(false)
  })
})
