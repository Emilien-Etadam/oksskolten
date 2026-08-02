import { useRef } from 'react'
import { motion, useMotionValue, useTransform, type PanInfo } from 'framer-motion'
import { useNavigate } from 'react-router-dom'
import { ArrowRight, Check } from 'lucide-react'
import { ArticleCard, type ArticleDisplayConfig } from './article-card'
import { articleUrlToPath } from '../../lib/url'
import { isReadInSession } from '../../lib/readTracker'
import type { ArticleListItem } from '../../../shared/types'
import type { LayoutName } from '../../data/layouts'

interface SwipeableArticleCardProps extends ArticleDisplayConfig {
  article: ArticleListItem
  layout?: LayoutName
  isFeatured?: boolean
  onClick?: (e: React.MouseEvent<HTMLAnchorElement>) => void
  onMarkRead?: (articleId: number) => void
}

const SWIPE_THRESHOLD = 80
const VELOCITY_THRESHOLD = 500

export function SwipeableArticleCard({
  article,
  layout,
  isFeatured,
  dateMode,
  indicatorStyle,
  showUnreadIndicator,
  showThumbnails,
  onClick: onClickProp,
  onMarkRead,
}: SwipeableArticleCardProps) {
  const navigate = useNavigate()
  const x = useMotionValue(0)
  const isDragging = useRef(false)
  // Set on pointerup (before touchend) when a right swipe marked the article
  // read, so the touchend handler can keep the gesture from also opening the
  // sidebar drawer via its document-level swipe listener.
  const suppressNextTouchEnd = useRef(false)

  const isUnread = article.seen_at == null && !isReadInSession(article.id)
  const canMarkRead = isUnread && !!onMarkRead

  // Background indicator opacity based on drag distance
  const leftOpacity = useTransform(x, [-SWIPE_THRESHOLD, 0], [1, 0])
  const rightOpacity = useTransform(x, [0, SWIPE_THRESHOLD], [0, 1])

  const handleDragEnd = (_: unknown, info: PanInfo) => {
    const { offset, velocity } = info
    isDragging.current = false

    // Left swipe → open article
    if (offset.x < -SWIPE_THRESHOLD || velocity.x < -VELOCITY_THRESHOLD) {
      void navigate(articleUrlToPath(article.url))
      return
    }

    // Right swipe → mark as read without opening
    if (canMarkRead && (offset.x > SWIPE_THRESHOLD || velocity.x > VELOCITY_THRESHOLD)) {
      onMarkRead(article.id)
      suppressNextTouchEnd.current = true
    }
  }

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (suppressNextTouchEnd.current) {
      suppressNextTouchEnd.current = false
      e.stopPropagation()
    }
  }

  const handleClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
    // Let browser handle Cmd+Click, Ctrl+Click natively (open in new tab)
    if (e.metaKey || e.ctrlKey || e.button === 1) return
    e.preventDefault()
    // Only navigate if not dragging
    if (!isDragging.current) {
      if (onClickProp) { onClickProp(e) }
      else { void navigate(articleUrlToPath(article.url)) }
    }
  }

  return (
    <div className="relative overflow-hidden select-none" onTouchEnd={handleTouchEnd}>
      {/* Left swipe background (open article) */}
      <motion.div
        className="absolute inset-0 flex items-center justify-end pr-6 bg-accent/20"
        style={{ opacity: leftOpacity }}
      >
        <ArrowRight className="w-5 h-5 text-accent" />
      </motion.div>

      {/* Right swipe background (mark as read) */}
      {canMarkRead && (
        <motion.div
          className="absolute inset-0 flex items-center justify-start pl-6 bg-accent/20"
          style={{ opacity: rightOpacity }}
        >
          <Check className="w-5 h-5 text-accent" />
        </motion.div>
      )}

      {/* Draggable card */}
      <motion.div
        style={{ x }}
        drag="x"
        dragConstraints={{ left: 0, right: 0 }}
        dragSnapToOrigin
        dragElastic={canMarkRead ? { left: 0.3, right: 0.5 } : { left: 0.3, right: 0.3 }}
        onDragStart={() => { isDragging.current = true }}
        onDragEnd={handleDragEnd}
        className="relative bg-bg"
      >
        <ArticleCard
          article={article}
          layout={layout}
          isFeatured={isFeatured}
          dateMode={dateMode}
          indicatorStyle={indicatorStyle}
          showUnreadIndicator={showUnreadIndicator}
          showThumbnails={showThumbnails}
          onClick={handleClick}
          onMarkRead={onMarkRead}
        />
      </motion.div>
    </div>
  )
}
