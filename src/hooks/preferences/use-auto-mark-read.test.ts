import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useAutoMarkRead } from './use-auto-mark-read'

describe('useAutoMarkRead', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('defaults to off', () => {
    const { result } = renderHook(() => useAutoMarkRead())
    expect(result.current.autoMarkRead).toBe('off')
  })

  it('reads stored value from localStorage', () => {
    localStorage.setItem('auto-mark-read', 'on')
    const { result } = renderHook(() => useAutoMarkRead())
    expect(result.current.autoMarkRead).toBe('on')
  })

  it('ignores invalid localStorage value', () => {
    localStorage.setItem('auto-mark-read', 'garbage')
    const { result } = renderHook(() => useAutoMarkRead())
    expect(result.current.autoMarkRead).toBe('off')
  })

  it('persists changes to localStorage', () => {
    const { result } = renderHook(() => useAutoMarkRead())
    act(() => result.current.setAutoMarkRead('on'))
    expect(result.current.autoMarkRead).toBe('on')
    expect(localStorage.getItem('auto-mark-read')).toBe('on')
  })
})
