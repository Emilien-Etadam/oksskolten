import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useDarkMode } from './use-dark-mode'

describe('useDarkMode', () => {
  let matchMediaListeners: Array<(e: { matches: boolean }) => void>
  let matchMediaMatches: boolean

  beforeEach(() => {
    localStorage.clear()
    document.documentElement.classList.remove('dark')
    document.documentElement.style.colorScheme = ''

    matchMediaListeners = []
    matchMediaMatches = false

    vi.stubGlobal('matchMedia', vi.fn((query: string) => ({
      matches: matchMediaMatches,
      media: query,
      addEventListener: (_: string, cb: (e: { matches: boolean }) => void) => {
        matchMediaListeners.push(cb)
      },
      removeEventListener: (_: string, cb: (e: { matches: boolean }) => void) => {
        matchMediaListeners = matchMediaListeners.filter(l => l !== cb)
      },
    })))
  })

  it('defaults to system mode', () => {
    const { result } = renderHook(() => useDarkMode())
    expect(result.current.colorMode).toBe('system')
  })

  it('reads stored dark mode from localStorage', () => {
    localStorage.setItem('theme', 'dark')
    const { result } = renderHook(() => useDarkMode())
    expect(result.current.colorMode).toBe('dark')
    expect(result.current.isDark).toBe(true)
  })

  it('reads stored light mode from localStorage', () => {
    localStorage.setItem('theme', 'light')
    const { result } = renderHook(() => useDarkMode())
    expect(result.current.colorMode).toBe('light')
    expect(result.current.isDark).toBe(false)
  })

  it('adds dark class when isDark is true', () => {
    localStorage.setItem('theme', 'dark')
    renderHook(() => useDarkMode())
    expect(document.documentElement.classList.contains('dark')).toBe(true)
    expect(document.documentElement.style.colorScheme).toBe('dark')
  })

  it('removes dark class when light', () => {
    document.documentElement.classList.add('dark')
    localStorage.setItem('theme', 'light')
    renderHook(() => useDarkMode())
    expect(document.documentElement.classList.contains('dark')).toBe(false)
    expect(document.documentElement.style.colorScheme).toBe('light')
  })

  it('persists mode changes to localStorage', () => {
    const { result } = renderHook(() => useDarkMode())
    act(() => result.current.setColorMode('dark'))
    expect(localStorage.getItem('theme')).toBe('dark')
    expect(result.current.colorMode).toBe('dark')
  })

  it('in system mode, follows matchMedia', () => {
    matchMediaMatches = true
    const { result } = renderHook(() => useDarkMode())
    expect(result.current.colorMode).toBe('system')
    expect(result.current.isDark).toBe(true)
  })
})
