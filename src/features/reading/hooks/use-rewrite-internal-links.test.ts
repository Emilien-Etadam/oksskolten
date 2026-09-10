import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'

const mockApiPost = vi.fn()

vi.mock('@/lib/fetcher', () => ({
  apiPost: (...args: unknown[]) => mockApiPost(...args),
}))

import { useRewriteInternalLinks } from './use-rewrite-internal-links'

describe('useRewriteInternalLinks', () => {
  beforeEach(() => {
    mockApiPost.mockReset()
  })

  it('returns original html when disabled', () => {
    const html = '<a href="https://example.com/post">link</a>'
    const { result } = renderHook(() =>
      useRewriteInternalLinks(html, 'https://example.com/article', false),
    )
    expect(result.current.rewrittenHtml).toBe(html)
    expect(result.current.rewriting).toBe(false)
  })

  it('returns original html when html is empty', () => {
    const { result } = renderHook(() =>
      useRewriteInternalLinks('', 'https://example.com/article', true),
    )
    expect(result.current.rewrittenHtml).toBe('')
    expect(result.current.rewriting).toBe(false)
  })

  it('returns original html when articleUrl is invalid', () => {
    const html = '<a href="/post">link</a>'
    const { result } = renderHook(() =>
      useRewriteInternalLinks(html, 'not-a-url', true),
    )
    expect(result.current.rewrittenHtml).toBe(html)
  })

  it('returns original html when no same-domain links exist', () => {
    const html = '<a href="https://other.com/post">link</a>'
    const { result } = renderHook(() =>
      useRewriteInternalLinks(html, 'https://example.com/article', true),
    )
    expect(result.current.rewrittenHtml).toBe(html)
    expect(mockApiPost).not.toHaveBeenCalled()
  })

  it('rewrites matching links to internal paths', async () => {
    mockApiPost.mockResolvedValue({
      existing: ['https://example.com/post-1'],
    })

    const html = '<a href="https://example.com/post-1">Post 1</a><a href="https://example.com/post-2">Post 2</a>'
    const { result } = renderHook(() =>
      useRewriteInternalLinks(html, 'https://example.com/article', true),
    )

    await waitFor(() => {
      expect(result.current.rewriting).toBe(false)
      expect(result.current.rewrittenHtml).toContain('data-internal-link="true"')
      expect(result.current.rewrittenHtml).toContain('/example.com/post-1')
    })

    // post-2 should not be rewritten
    expect(result.current.rewrittenHtml).toContain('href="https://example.com/post-2"')
  })

  it('falls back to original html on API error', async () => {
    mockApiPost.mockRejectedValue(new Error('Network error'))

    const html = '<a href="https://example.com/post">link</a>'
    const { result } = renderHook(() =>
      useRewriteInternalLinks(html, 'https://example.com/article', true),
    )

    await waitFor(() => {
      expect(result.current.rewriting).toBe(false)
    })
    expect(result.current.rewrittenHtml).toBe(html)
  })

  it('sets rewriting to true while loading', async () => {
    let resolve: (v: unknown) => void
    mockApiPost.mockReturnValue(new Promise(r => { resolve = r }))

    const html = '<a href="https://example.com/post">link</a>'
    const { result } = renderHook(() =>
      useRewriteInternalLinks(html, 'https://example.com/article', true),
    )

    await waitFor(() => {
      expect(result.current.rewriting).toBe(true)
    })

    resolve!({ existing: [] })

    await waitFor(() => {
      expect(result.current.rewriting).toBe(false)
    })
  })
})
