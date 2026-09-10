import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useShowThumbnails } from './use-show-thumbnails'

describe('useShowThumbnails', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('defaults to "on"', () => {
    const { result } = renderHook(() => useShowThumbnails())
    expect(result.current.showThumbnails).toBe('on')
  })

  it('reads stored value from localStorage', () => {
    localStorage.setItem('show-thumbnails', 'off')
    const { result } = renderHook(() => useShowThumbnails())
    expect(result.current.showThumbnails).toBe('off')
  })

  it('ignores invalid localStorage values', () => {
    localStorage.setItem('show-thumbnails', 'invalid')
    const { result } = renderHook(() => useShowThumbnails())
    expect(result.current.showThumbnails).toBe('on')
  })

  it('persists changes to localStorage', () => {
    const { result } = renderHook(() => useShowThumbnails())
    act(() => result.current.setShowThumbnails('off'))
    expect(result.current.showThumbnails).toBe('off')
    expect(localStorage.getItem('show-thumbnails')).toBe('off')
  })

  it('persists toggle back to on', () => {
    localStorage.setItem('show-thumbnails', 'off')
    const { result } = renderHook(() => useShowThumbnails())
    act(() => result.current.setShowThumbnails('on'))
    expect(result.current.showThumbnails).toBe('on')
    expect(localStorage.getItem('show-thumbnails')).toBe('on')
  })
})
