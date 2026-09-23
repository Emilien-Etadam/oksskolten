import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import useSWR from 'swr'
import { ChevronRight, Hash, Shapes } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { fetcher } from '@/lib/fetcher'
import { useI18n } from '@/i18n'
import type { ClassificationCount, ClassificationOverview } from '../../../../shared/classification'

interface Props {
  onNavigate?: () => void
}

const COLLAPSED_KEY = 'sidebar-classification-collapsed'

function readCollapsed(): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem(COLLAPSED_KEY) ?? '{}') as Record<string, boolean>
  } catch {
    return {}
  }
}

function writeCollapsed(value: Record<string, boolean>): void {
  try {
    localStorage.setItem(COLLAPSED_KEY, JSON.stringify(value))
  } catch { /* storage unavailable: the section just forgets its state */ }
}

/**
 * Sidebar sections listing the article themes and formats assigned by the
 * local model, with their unread counts. Hidden while classification is off.
 */
export function ClassificationList({ onNavigate }: Props) {
  const { t } = useI18n()
  const { data } = useSWR<ClassificationOverview>('/api/classification', fetcher, { refreshInterval: 60_000 })
  const [collapsed, setCollapsed] = useState(readCollapsed)

  if (!data?.enabled) return null

  function toggle(section: string) {
    setCollapsed(prev => {
      const next = { ...prev, [section]: !prev[section] }
      writeCollapsed(next)
      return next
    })
  }

  return (
    <>
      <Section
        id="themes"
        title={t('classification.themes')}
        icon={Hash}
        basePath="/themes"
        items={data.themes}
        collapsed={!!collapsed.themes}
        onToggle={() => toggle('themes')}
        onNavigate={onNavigate}
      />
      <Section
        id="formats"
        title={t('classification.formats')}
        icon={Shapes}
        basePath="/formats"
        items={data.formats}
        collapsed={!!collapsed.formats}
        onToggle={() => toggle('formats')}
        onNavigate={onNavigate}
      />
    </>
  )
}

function Section({ id, title, icon: Icon, basePath, items, collapsed, onToggle, onNavigate }: {
  id: string
  title: string
  icon: LucideIcon
  basePath: string
  items: ClassificationCount[]
  collapsed: boolean
  onToggle: () => void
  onNavigate?: () => void
}) {
  const navigate = useNavigate()
  const location = useLocation()

  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={!collapsed}
        aria-controls={`classification-${id}`}
        className="w-full px-2 pt-4 pb-1 flex items-center gap-1 text-[11px] font-medium uppercase tracking-wider text-muted hover:text-text"
      >
        <ChevronRight size={12} strokeWidth={1.5} className={`transition-transform ${collapsed ? '' : 'rotate-90'}`} />
        {title}
      </button>
      {!collapsed && (
        <div id={`classification-${id}`}>
          {items.map(item => {
            const path = `${basePath}/${item.id}`
            const selected = location.pathname === path
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => { void navigate(path); onNavigate?.() }}
                className={`w-full text-left px-2 py-1.5 rounded-lg text-sm flex items-center justify-between outline-none transition-colors hover:bg-hover-sidebar ${
                  selected ? 'font-medium text-accent' : 'text-text'
                }`}
              >
                <span className="flex items-center gap-2 min-w-0">
                  <Icon size={16} strokeWidth={1.5} className="shrink-0" />
                  <span className="truncate">{item.label}</span>
                </span>
                {item.unread_count > 0 && (
                  <span
                    className="text-[11px] text-accent rounded-full px-1.5 leading-relaxed ml-2 shrink-0"
                    style={{ backgroundColor: 'color-mix(in srgb, var(--color-accent) 15%, transparent)' }}
                  >
                    {item.unread_count}
                  </span>
                )}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
