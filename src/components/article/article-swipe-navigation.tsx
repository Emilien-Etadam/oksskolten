import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useKeyboardNavigationContext } from '../../contexts/keyboard-navigation-context'
import { useExtendArticleList } from '../../hooks/use-extend-article-list'
import { useIsTouchDevice } from '../../hooks/use-is-touch-device'
import { useI18n } from '../../lib/i18n'
import { articleUrlToPath } from '../../lib/url'
import { dayKeyOf, useDayLabel } from './day-separator'

const SWIPE_THRESHOLD_PX = 60
/** Touches starting this close to the left edge are left to the browser's native back gesture */
const EDGE_GUARD_PX = 32
/** Prefetch the next window of the list when this few loaded articles remain ahead */
const NEAR_END_THRESHOLD = 5

interface ArticleSwipeNavigationProps {
  currentArticleId: string
}

/** The article waiting behind a day divider, and the direction that led to it. */
interface PendingCrossing {
  targetId: string
  url: string
  date: string | null
  offset: 1 | -1
}

/**
 * Swipe left/right (or press ArrowRight/ArrowLeft) on the article detail page
 * to move to the next/previous article of the last visited list. Complements
 * ArticleZapNavigation using the same context.
 *
 * Crossing into another publication day stops on a full-screen divider naming
 * that day; repeating the same gesture continues to the article, the opposite
 * one (or Escape) stays put. Articles with no publication date never raise a
 * divider — there is no day to announce.
 */
export function ArticleSwipeNavigation({ currentArticleId }: ArticleSwipeNavigationProps) {
  const navigate = useNavigate()
  const { t } = useI18n()
  const dayLabel = useDayLabel()
  const isTouchDevice = useIsTouchDevice()
  const { articleIds, articleUrls, articleDates, setFocusedItemId } = useKeyboardNavigationContext()
  const extendList = useExtendArticleList()
  const [pending, setPending] = useState<PendingCrossing | null>(null)

  // Keep latest values in refs so the stable document listeners never go stale
  const stateRef = useRef({ currentArticleId, articleIds, articleUrls, articleDates, navigate, setFocusedItemId, extendList, pending })
  stateRef.current = { currentArticleId, articleIds, articleUrls, articleDates, navigate, setFocusedItemId, extendList, pending }

  // A divider belongs to the article it was raised from
  useEffect(() => {
    setPending(null)
  }, [currentArticleId])

  useEffect(() => {
    const go = (targetId: string, url: string) => {
      // Clear here rather than relying on the currentArticleId effect: the
      // divider must not outlive the navigation it was gating.
      setPending(null)
      stateRef.current.setFocusedItemId(targetId)
      void stateRef.current.navigate(articleUrlToPath(url))
    }

    /** Move to a resolved target, unless it starts another publication day. */
    const arrive = (targetId: string, url: string, offset: 1 | -1): void => {
      const { currentArticleId, articleDates } = stateRef.current
      const fromDay = dayKeyOf(articleDates[currentArticleId])
      const toDay = dayKeyOf(articleDates[targetId])
      if (fromDay && toDay && fromDay !== toDay) {
        setPending({ targetId, url, date: articleDates[targetId] ?? null, offset })
        return
      }
      go(targetId, url)
    }

    const goTo = (offset: 1 | -1): boolean => {
      const { currentArticleId, articleIds, articleUrls, extendList, pending } = stateRef.current

      // A divider is showing: the same direction continues, the opposite backs out
      if (pending) {
        if (offset === pending.offset) go(pending.targetId, pending.url)
        else setPending(null)
        return true
      }

      const index = articleIds.indexOf(currentArticleId)
      if (index === -1) return false
      const targetId = articleIds[index + offset]
      const url = targetId ? articleUrls[targetId] : undefined
      if (!targetId || !url) {
        // End of the loaded list: fetch the next window, then navigate
        if (offset === 1) {
          void extendList().then(extended => {
            if (!extended) return
            const nextId = extended.ids[extended.ids.indexOf(currentArticleId) + 1]
            const nextUrl = nextId ? extended.urls[nextId] : undefined
            if (!nextId || !nextUrl) return
            const dates = extended.dates ?? {}
            const fromDay = dayKeyOf(dates[currentArticleId])
            const toDay = dayKeyOf(dates[nextId])
            if (fromDay && toDay && fromDay !== toDay) {
              setPending({ targetId: nextId, url: nextUrl, date: dates[nextId] ?? null, offset: 1 })
              return
            }
            go(nextId, nextUrl)
          })
        }
        return false
      }
      arrive(targetId, url, offset)
      // Prefetch more of the list when nearing the end of what is loaded
      if (offset === 1 && articleIds.length - (index + 1) <= NEAR_END_THRESHOLD) {
        void extendList()
      }
      return true
    }

    const hasBlockingDialog = () =>
      !!document.querySelector('[role="dialog"][data-state="open"]:not([data-keyboard-nav-passthrough])')

    let touchStart: { x: number; y: number } | null = null

    const onTouchStart = (e: TouchEvent) => {
      const touch = e.touches[0]
      touchStart = touch.clientX < EDGE_GUARD_PX ? null : { x: touch.clientX, y: touch.clientY }
    }

    const onTouchEnd = (e: TouchEvent) => {
      if (!touchStart) return
      const touch = e.changedTouches[0]
      const dx = touch.clientX - touchStart.x
      const dy = touch.clientY - touchStart.y
      touchStart = null
      if (Math.abs(dx) < SWIPE_THRESHOLD_PX || Math.abs(dy) > Math.abs(dx)) return
      if (hasBlockingDialog()) return
      // Swipe left → next article, swipe right → previous article
      if (goTo(dx < 0 ? 1 : -1)) {
        // Handled: keep document-level swipe handlers (sidebar drawer) from also firing
        e.stopPropagation()
      }
    }

    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable) return
      if (e.key === 'Escape' && stateRef.current.pending) {
        setPending(null)
        return
      }
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
      if (hasBlockingDialog()) return
      goTo(e.key === 'ArrowRight' ? 1 : -1)
    }

    // Capture phase so a handled swipe can stop the drawer's bubble-phase document listener
    document.addEventListener('touchstart', onTouchStart, { capture: true, passive: true })
    document.addEventListener('touchend', onTouchEnd, { capture: true, passive: true })
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('touchstart', onTouchStart, { capture: true })
      document.removeEventListener('touchend', onTouchEnd, { capture: true })
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [])

  if (!pending) return null

  return (
    <div
      role="separator"
      aria-label={dayLabel(pending.date)}
      onClick={() => {
        setFocusedItemId(pending.targetId)
        void navigate(articleUrlToPath(pending.url))
      }}
      className="fixed inset-0 z-[70] bg-bg flex flex-col items-center justify-center gap-3 select-none cursor-pointer"
    >
      <span className="h-px w-16 bg-border" />
      <span className="text-2xl font-semibold text-text text-center px-6">{dayLabel(pending.date)}</span>
      <span className="text-xs text-muted">
        {isTouchDevice ? t('articles.dayContinueTouch') : t('articles.dayContinue')}
      </span>
    </div>
  )
}
