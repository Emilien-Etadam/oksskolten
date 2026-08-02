import { useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useKeyboardNavigationContext } from '../../contexts/keyboard-navigation-context'
import { articleUrlToPath } from '../../lib/url'

const SWIPE_THRESHOLD_PX = 60
/** Touches starting this close to the left edge are left to the browser's native back gesture */
const EDGE_GUARD_PX = 32

interface ArticleSwipeNavigationProps {
  currentArticleId: string
}

/**
 * Renders nothing. Swipe left/right (or press ArrowRight/ArrowLeft) on the
 * article detail page to move to the next/previous article of the last
 * visited list. Complements ArticleZapNavigation using the same context.
 */
export function ArticleSwipeNavigation({ currentArticleId }: ArticleSwipeNavigationProps) {
  const navigate = useNavigate()
  const { articleIds, articleUrls, setFocusedItemId } = useKeyboardNavigationContext()

  // Keep latest values in refs so the stable document listeners never go stale
  const stateRef = useRef({ currentArticleId, articleIds, articleUrls, navigate, setFocusedItemId })
  stateRef.current = { currentArticleId, articleIds, articleUrls, navigate, setFocusedItemId }

  useEffect(() => {
    const goTo = (offset: 1 | -1): boolean => {
      const { currentArticleId, articleIds, articleUrls, navigate, setFocusedItemId } = stateRef.current
      const index = articleIds.indexOf(currentArticleId)
      if (index === -1) return false
      const targetId = articleIds[index + offset]
      const url = targetId ? articleUrls[targetId] : undefined
      if (!targetId || !url) return false
      setFocusedItemId(targetId)
      void navigate(articleUrlToPath(url))
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
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
      const target = e.target as HTMLElement
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable) return
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

  return null
}
