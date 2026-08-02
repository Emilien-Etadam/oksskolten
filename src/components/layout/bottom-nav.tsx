import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Inbox, Search, Bookmark, MessagesSquare, Menu } from 'lucide-react'
import { useAppLayout } from '../../app'
import { useI18n } from '../../lib/i18n'
import { SearchDialog } from '../ui/search-dialog'

/**
 * Newspaper-app-style bottom tab bar with the main destinations.
 * Shown when the sidebar is closed (always on mobile, on desktop only
 * with the sidebar collapsed). The Menu tab opens the sidebar, which
 * holds everything else. Hidden on the chat page so the bar never
 * covers the message input.
 */
export function BottomNav() {
  const { sidebarOpen, setSidebarOpen } = useAppLayout()
  const location = useLocation()
  const navigate = useNavigate()
  const { t } = useI18n()
  const [searchOpen, setSearchOpen] = useState(false)

  if (sidebarOpen || location.pathname.startsWith('/chat')) return null

  const items = [
    { icon: Inbox, label: t('feeds.inbox'), selected: location.pathname === '/inbox', onClick: () => { void navigate('/inbox') } },
    { icon: Search, label: t('search.title'), selected: false, onClick: () => setSearchOpen(true) },
    { icon: Bookmark, label: t('feeds.bookmarks'), selected: location.pathname === '/bookmarks', onClick: () => { void navigate('/bookmarks') } },
    { icon: MessagesSquare, label: t('chat.title'), selected: false, onClick: () => { void navigate('/chat') } },
    { icon: Menu, label: t('header.menu'), selected: false, onClick: () => setSidebarOpen(true) },
  ]

  return (
    <>
      {/* In-flow spacer so scrolled content is never hidden behind the fixed bar */}
      <div className="h-14" style={{ marginBottom: 'var(--safe-area-inset-bottom)' }} />
      <nav
        className="fixed bottom-0 left-0 right-0 z-30 border-t border-border select-none"
        style={{ backgroundColor: 'rgb(var(--color-bg-header-rgb) / 0.95)', paddingBottom: 'var(--safe-area-inset-bottom)' }}
      >
        <div className="flex">
          {items.map(({ icon: Icon, label, selected, onClick }) => (
            <button
              key={label}
              onClick={onClick}
              className={`flex h-14 flex-1 flex-col items-center justify-center gap-1 text-[10px] font-medium transition-colors ${
                selected ? 'text-accent' : 'text-muted hover:text-text'
              }`}
            >
              <Icon className="w-5 h-5" strokeWidth={1.8} />
              {label}
            </button>
          ))}
        </div>
      </nav>
      {searchOpen && <SearchDialog onClose={() => setSearchOpen(false)} />}
    </>
  )
}
