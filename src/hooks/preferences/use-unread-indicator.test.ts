import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useUnreadIndicator } from './use-unread-indicator'

describe('useUnreadIndicator', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('defaults to on', () => {
    const { result } = renderHook(() => useUnreadIndicator())
    expect(result.current.showUnreadIndicator).toBe('on')
  })

  it('reads stored value from localStorage', () => {
    localStorage.setItem('unread-indicator', 'off')
    const { result } = renderHook(() => useUnreadIndicator())
    expect(result.current.showUnreadIndicator).toBe('off')
  })

  it('ignores invalid localStorage value', () => {
    localStorage.setItem('unread-indicator', 'bad')
    const { result } = renderHook(() => useUnreadIndicator())
    expect(result.current.showUnreadIndicator).toBe('on')
  })

  it('persists changes to localStorage', () => {
    const { result } = renderHook(() => useUnreadIndicator())
    act(() => result.current.setShowUnreadIndicator('off'))
    expect(result.current.showUnreadIndicator).toBe('off')
    expect(localStorage.getItem('unread-indicator')).toBe('off')
  })
})
