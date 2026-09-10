import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useDateMode } from './use-date-mode'

describe('useDateMode', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('defaults to relative', () => {
    const { result } = renderHook(() => useDateMode())
    expect(result.current.dateMode).toBe('relative')
  })

  it('reads stored value from localStorage', () => {
    localStorage.setItem('date-mode', 'absolute')
    const { result } = renderHook(() => useDateMode())
    expect(result.current.dateMode).toBe('absolute')
  })

  it('ignores invalid localStorage value', () => {
    localStorage.setItem('date-mode', 'invalid')
    const { result } = renderHook(() => useDateMode())
    expect(result.current.dateMode).toBe('relative')
  })

  it('persists changes to localStorage', () => {
    const { result } = renderHook(() => useDateMode())
    act(() => result.current.setDateMode('absolute'))
    expect(result.current.dateMode).toBe('absolute')
    expect(localStorage.getItem('date-mode')).toBe('absolute')
  })
})
