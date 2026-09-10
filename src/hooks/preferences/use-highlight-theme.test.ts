import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useHighlightTheme } from './use-highlight-theme'

describe('useHighlightTheme', () => {
  beforeEach(() => {
    localStorage.clear()
    // Clean up any link elements from previous tests
    const existing = document.getElementById('hljs-theme-link')
    if (existing) existing.remove()
  })

  it('uses default family when no override set', () => {
    const { result } = renderHook(() => useHighlightTheme('github', false))
    expect(result.current.highlightTheme).toBe('github')
    expect(result.current.highlightThemeOverride).toBeNull()
  })

  it('reads override from localStorage', () => {
    localStorage.setItem('highlight-theme-override', 'atom-one')
    const { result } = renderHook(() => useHighlightTheme('github', false))
    expect(result.current.highlightTheme).toBe('atom-one')
    expect(result.current.highlightThemeOverride).toBe('atom-one')
  })

  it('creates a link element in document head', () => {
    renderHook(() => useHighlightTheme('github', false))
    const link = document.getElementById('hljs-theme-link') as HTMLLinkElement
    expect(link).not.toBeNull()
    expect(link.href).toContain('/hljs-themes/github.min.css')
  })

  it('uses dark variant when isDark is true', () => {
    renderHook(() => useHighlightTheme('github', true))
    const link = document.getElementById('hljs-theme-link') as HTMLLinkElement
    expect(link.href).toContain('/hljs-themes/github-dark.min.css')
  })

  it('persists override to localStorage', () => {
    const { result } = renderHook(() => useHighlightTheme('github', false))
    act(() => result.current.setHighlightTheme('nord'))
    expect(localStorage.getItem('highlight-theme-override')).toBe('nord')
    expect(result.current.highlightTheme).toBe('nord')
  })

  it('removes override from localStorage when set to null', () => {
    localStorage.setItem('highlight-theme-override', 'nord')
    const { result } = renderHook(() => useHighlightTheme('github', false))
    act(() => result.current.setHighlightTheme(null))
    expect(localStorage.getItem('highlight-theme-override')).toBeNull()
    expect(result.current.highlightTheme).toBe('github')
  })
})
