import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { dayKeyOf, DaySeparator } from './day-separator'

describe('dayKeyOf', () => {
  it('returns the local calendar day', () => {
    const iso = new Date(2026, 7, 23, 14, 30).toISOString()
    expect(dayKeyOf(iso)).toBe('2026-08-23')
  })

  it('groups timestamps of the same local day', () => {
    const morning = new Date(2026, 7, 23, 1, 0).toISOString()
    const evening = new Date(2026, 7, 23, 23, 0).toISOString()
    expect(dayKeyOf(morning)).toBe(dayKeyOf(evening))
  })

  it('has no key for a missing or unparseable date', () => {
    expect(dayKeyOf(null)).toBe('')
    expect(dayKeyOf(undefined)).toBe('')
    expect(dayKeyOf('not a date')).toBe('')
  })
})

describe('DaySeparator', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 7, 23, 12, 0))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('names today and yesterday', () => {
    const { unmount } = render(<DaySeparator date={new Date(2026, 7, 23, 8, 0).toISOString()} />)
    expect(screen.getByText('Today')).toBeTruthy()
    unmount()

    render(<DaySeparator date={new Date(2026, 7, 22, 8, 0).toISOString()} />)
    expect(screen.getByText('Yesterday')).toBeTruthy()
  })

  it('spells out older days', () => {
    render(<DaySeparator date={new Date(2026, 7, 17, 8, 0).toISOString()} />)
    expect(screen.getByText(/August/)).toBeTruthy()
  })

  it('labels articles with no date', () => {
    render(<DaySeparator date={null} />)
    expect(screen.getByText('Undated')).toBeTruthy()
  })
})
