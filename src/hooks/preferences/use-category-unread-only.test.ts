import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useCategoryUnreadOnly } from './use-category-unread-only'

describe('useCategoryUnreadOnly', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('defaults to "off"', () => {
    const { result } = renderHook(() => useCategoryUnreadOnly())
    expect(result.current.categoryUnreadOnly).toBe('off')
  })

  it('reads stored value from localStorage', () => {
    localStorage.setItem('category-unread-only', 'on')
    const { result } = renderHook(() => useCategoryUnreadOnly())
    expect(result.current.categoryUnreadOnly).toBe('on')
  })

  it('ignores invalid localStorage values', () => {
    localStorage.setItem('category-unread-only', 'invalid')
    const { result } = renderHook(() => useCategoryUnreadOnly())
    expect(result.current.categoryUnreadOnly).toBe('off')
  })

  it('persists changes to localStorage', () => {
    const { result } = renderHook(() => useCategoryUnreadOnly())
    act(() => result.current.setCategoryUnreadOnly('on'))
    expect(result.current.categoryUnreadOnly).toBe('on')
    expect(localStorage.getItem('category-unread-only')).toBe('on')
  })

  it('persists toggle back to off', () => {
    localStorage.setItem('category-unread-only', 'on')
    const { result } = renderHook(() => useCategoryUnreadOnly())
    act(() => result.current.setCategoryUnreadOnly('off'))
    expect(result.current.categoryUnreadOnly).toBe('off')
    expect(localStorage.getItem('category-unread-only')).toBe('off')
  })
})
