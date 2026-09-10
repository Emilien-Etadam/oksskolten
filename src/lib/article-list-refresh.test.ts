import { describe, it, expect, vi } from 'vitest'
import { subscribeArticleListRefresh, refreshArticleLists } from './article-list-refresh'

describe('article list refresh bus', () => {
  it('calls every subscriber on refresh', () => {
    const first = vi.fn()
    const second = vi.fn()
    const unsubFirst = subscribeArticleListRefresh(first)
    const unsubSecond = subscribeArticleListRefresh(second)

    refreshArticleLists()

    expect(first).toHaveBeenCalledTimes(1)
    expect(second).toHaveBeenCalledTimes(1)
    unsubFirst()
    unsubSecond()
  })

  it('stops calling a subscriber once it unsubscribes', () => {
    const listener = vi.fn()
    const unsubscribe = subscribeArticleListRefresh(listener)
    unsubscribe()

    refreshArticleLists()

    expect(listener).not.toHaveBeenCalled()
  })

  it('is a no-op when nothing is subscribed', () => {
    expect(() => refreshArticleLists()).not.toThrow()
  })

  it('lets a listener unsubscribe from inside the refresh', () => {
    let unsubscribe = () => {}
    const listener = vi.fn(() => { unsubscribe() })
    unsubscribe = subscribeArticleListRefresh(listener)

    refreshArticleLists()
    refreshArticleLists()

    expect(listener).toHaveBeenCalledTimes(1)
  })
})
