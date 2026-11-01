import { describe, it, expect } from 'vitest'
import { extractDomain, isGithubStarsFeedUrl } from './url'

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

describe('isGithubStarsFeedUrl', () => {
  it('matches the canonical stars feed URL', () => {
    expect(isGithubStarsFeedUrl('https://github.com/stars/octocat')).toBe(true)
  })

  it('rejects other GitHub URLs', () => {
    expect(isGithubStarsFeedUrl('https://github.com/octocat/hello/releases.atom')).toBe(false)
    expect(isGithubStarsFeedUrl('https://github.com/trending')).toBe(false)
  })
})
