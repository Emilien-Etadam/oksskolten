import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { Check } from 'lucide-react'
import { useI18n } from '../../lib/i18n'

interface MarkReadButtonProps {
  onClick: () => void
  className?: string
  /**
   * `round` — the small circular check used inside card meta rows.
   * `edge` — a thin full-height strip pinned to the row's right edge that
   * stretches into a square (side = row height) while the row is hovered.
   * Requires the row to be `relative group`.
   */
  variant?: 'round' | 'edge'
}

/**
 * Check button shown on unread article cards: mark the article as read
 * without opening it. Rendered inside the card's anchor, so the click must
 * not bubble into navigation.
 */
export function MarkReadButton({ onClick, className = '', variant = 'round' }: MarkReadButtonProps) {
  const { t } = useI18n()
  const ref = useRef<HTMLButtonElement>(null)
  // The expanded width has to equal the row height, and CSS cannot derive it:
  // `aspect-square` on a stretched flex item sizes from the icon, and `width`
  // cannot animate to an aspect-derived `auto`. So measure the row and animate
  // towards that value.
  const [side, setSide] = useState(0)

  useEffect(() => {
    if (variant !== 'edge') return
    const el = ref.current
    if (!el) return
    // measure the row, not the resting pill: the pill is inset, the expanded
    // square must match the row's full height
    const row = el.parentElement ?? el
    const observer = new ResizeObserver(() => setSide(row.clientHeight))
    observer.observe(row)
    return () => observer.disconnect()
  }, [variant])

  const isEdge = variant === 'edge'
  const style = isEdge && side > 0 ? ({ '--mark-read-square': `${side}px` } as CSSProperties) : undefined

  return (
    <button
      ref={ref}
      type="button"
      style={style}
      title={t('article.markAsRead')}
      aria-label={t('article.markAsRead')}
      onClick={(e) => {
        e.preventDefault()
        e.stopPropagation()
        onClick()
      }}
      className={
        isEdge
          ? `absolute inset-y-1.5 right-1.5 z-10 flex items-center justify-center overflow-hidden w-1.5 rounded-full bg-error text-error opacity-70 transition-[width,inset,border-radius,opacity,color] duration-200 ease-out motion-reduce:transition-none group-hover:inset-y-0 group-hover:right-0 group-hover:w-[var(--mark-read-square,2.5rem)] group-hover:rounded-none group-hover:opacity-100 group-hover:text-white focus-visible:inset-y-0 focus-visible:right-0 focus-visible:w-[var(--mark-read-square,2.5rem)] focus-visible:rounded-none focus-visible:opacity-100 focus-visible:text-white focus-visible:outline-none ${className}`
          : `shrink-0 flex items-center justify-center w-7 h-7 rounded-full text-muted hover:text-accent hover:bg-hover transition-colors ${className}`
      }
    >
      <Check
        className={
          isEdge
            ? 'w-4 h-4 shrink-0 opacity-0 transition-opacity duration-150 delay-75 motion-reduce:transition-none group-hover:opacity-100 group-focus-within:opacity-100'
            : 'w-4 h-4'
        }
      />
    </button>
  )
}
