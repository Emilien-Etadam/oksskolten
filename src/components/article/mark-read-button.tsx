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
  // cannot animate to an aspect-derived `auto`. So measure the strip — which
  // already spans the row — and animate towards that value.
  const [side, setSide] = useState(0)

  useEffect(() => {
    if (variant !== 'edge') return
    const el = ref.current
    if (!el) return
    const observer = new ResizeObserver(() => setSide(el.offsetHeight))
    observer.observe(el)
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
          ? `absolute inset-y-0 right-0 z-10 flex items-center justify-center overflow-hidden w-2.5 border-l border-border bg-error/25 text-error transition-[width,background-color,color] duration-200 ease-out motion-reduce:transition-none group-hover:w-[var(--mark-read-square,2.5rem)] group-hover:bg-error group-hover:text-white focus-visible:w-[var(--mark-read-square,2.5rem)] focus-visible:bg-error focus-visible:text-white focus-visible:outline-none ${className}`
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
