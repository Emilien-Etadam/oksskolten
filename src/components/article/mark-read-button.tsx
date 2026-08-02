import { Check } from 'lucide-react'
import { useI18n } from '../../lib/i18n'

interface MarkReadButtonProps {
  onClick: () => void
  className?: string
}

/**
 * Small check button shown on unread article cards: mark the article as
 * read without opening it. Rendered inside the card's anchor, so the click
 * must not bubble into navigation.
 */
export function MarkReadButton({ onClick, className = '' }: MarkReadButtonProps) {
  const { t } = useI18n()
  return (
    <button
      type="button"
      title={t('article.markAsRead')}
      aria-label={t('article.markAsRead')}
      onClick={(e) => {
        e.preventDefault()
        e.stopPropagation()
        onClick()
      }}
      className={`shrink-0 flex items-center justify-center w-7 h-7 rounded-full text-muted hover:text-accent hover:bg-hover transition-colors ${className}`}
    >
      <Check className="w-4 h-4" />
    </button>
  )
}
