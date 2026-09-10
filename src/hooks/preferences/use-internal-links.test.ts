import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useInternalLinks } from './use-internal-links'

describe('useInternalLinks', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('defaults to off', () => {
    const { result } = renderHook(() => useInternalLinks())
    expect(result.current.internalLinks).toBe('off')
  })

  it('reads stored value from localStorage', () => {
    localStorage.setItem('internal-links', 'on')
    const { result } = renderHook(() => useInternalLinks())
    expect(result.current.internalLinks).toBe('on')
  })

  it('ignores invalid localStorage value', () => {
    localStorage.setItem('internal-links', 'maybe')
    const { result } = renderHook(() => useInternalLinks())
    expect(result.current.internalLinks).toBe('off')
  })

  it('persists changes to localStorage', () => {
    const { result } = renderHook(() => useInternalLinks())
    act(() => result.current.setInternalLinks('on'))
    expect(result.current.internalLinks).toBe('on')
    expect(localStorage.getItem('internal-links')).toBe('on')
  })
})
