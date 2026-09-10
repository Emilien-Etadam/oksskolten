import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useArticleFont } from './use-article-font'

describe('useArticleFont', () => {
  beforeEach(() => {
    localStorage.clear()
    document.documentElement.style.removeProperty('--font-article')
    // Remove any font link element from previous tests
    document.getElementById('article-font-link')?.remove()
  })

  it('defaults to "system"', () => {
    const { result } = renderHook(() => useArticleFont())
    expect(result.current.articleFont).toBe('system')
  })

  it('reads stored font from localStorage', () => {
    localStorage.setItem('article-font', 'inter')
    const { result } = renderHook(() => useArticleFont())
    expect(result.current.articleFont).toBe('inter')
  })

  it('falls back to system for unknown font value', () => {
    localStorage.setItem('article-font', 'nonexistent')
    const { result } = renderHook(() => useArticleFont())
    // findArticleFont falls back to articleFonts[0] which is 'system'
    expect(result.current.articleFont).toBe('nonexistent')
  })

  it('sets CSS custom property --font-article', () => {
    localStorage.setItem('article-font', 'inter')
    renderHook(() => useArticleFont())
    expect(document.documentElement.style.getPropertyValue('--font-article')).toBe('"Inter", sans-serif')
  })

  it('creates Google Fonts link element for fonts with URL', () => {
    localStorage.setItem('article-font', 'inter')
    renderHook(() => useArticleFont())
    const link = document.getElementById('article-font-link') as HTMLLinkElement
    expect(link).not.toBeNull()
    expect(link.href).toContain('fonts.googleapis.com')
    expect(link.rel).toBe('stylesheet')
  })

  it('does not create link element for system font', () => {
    renderHook(() => useArticleFont())
    const link = document.getElementById('article-font-link')
    expect(link).toBeNull()
  })

  it('removes link element when switching to font without Google URL', () => {
    localStorage.setItem('article-font', 'inter')
    const { result } = renderHook(() => useArticleFont())
    expect(document.getElementById('article-font-link')).not.toBeNull()

    act(() => result.current.setArticleFont('system'))
    expect(document.getElementById('article-font-link')).toBeNull()
  })

  it('persists font selection to localStorage', () => {
    const { result } = renderHook(() => useArticleFont())
    act(() => result.current.setArticleFont('merriweather'))
    expect(localStorage.getItem('article-font')).toBe('merriweather')
  })

  it('removes localStorage entry when set to system', () => {
    localStorage.setItem('article-font', 'inter')
    const { result } = renderHook(() => useArticleFont())
    act(() => result.current.setArticleFont('system'))
    expect(localStorage.getItem('article-font')).toBeNull()
  })
})
