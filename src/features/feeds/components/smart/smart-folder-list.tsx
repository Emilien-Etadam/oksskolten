import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import useSWR from 'swr'
import { FolderSearch, Plus, Pencil, Trash2 } from 'lucide-react'
import { fetcher, apiPost, apiPatch, apiDelete } from '@/lib/fetcher'
import { useI18n } from '@/i18n'
import { SmartFolderDialog, type SmartFolderDraft } from './smart-folder-dialog'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
} from '@/components/ui/context-menu'

export interface SmartFolder {
  id: number
  name: string
  query: string
  sort_order: number
  unread_count: number | null
}

interface Props {
  onNavigate?: () => void
}

/**
 * Sidebar section listing the smart folders, with a "+" to create one.
 * Right-click (or long-press) a folder to edit or delete it.
 */
export function SmartFolderList({ onNavigate }: Props) {
  const { t } = useI18n()
  const navigate = useNavigate()
  const location = useLocation()
  const { data, mutate } = useSWR<{ folders: SmartFolder[] }>('/api/smart-folders', fetcher)
  const [dialog, setDialog] = useState<{ mode: 'create' } | { mode: 'edit'; folder: SmartFolder } | null>(null)
  const [deleting, setDeleting] = useState<SmartFolder | null>(null)

  const folders = data?.folders ?? []

  async function handleSave(draft: SmartFolderDraft) {
    if (dialog?.mode === 'edit') {
      await apiPatch(`/api/smart-folders/${dialog.folder.id}`, draft)
    } else {
      const created = await apiPost('/api/smart-folders', draft) as SmartFolder
      void navigate(`/smart/${created.id}`)
      onNavigate?.()
    }
    void mutate()
  }

  async function handleDelete(folder: SmartFolder) {
    await apiDelete(`/api/smart-folders/${folder.id}`)
    setDeleting(null)
    void mutate()
    if (location.pathname === `/smart/${folder.id}`) void navigate('/inbox')
  }

  return (
    <>
      <div className="px-2 pt-4 pb-1 flex items-center justify-between">
        <h2 className="text-[11px] font-medium uppercase tracking-wider text-muted">{t('smart.title')}</h2>
        <button
          type="button"
          onClick={() => setDialog({ mode: 'create' })}
          className="text-muted hover:text-text rounded p-0.5"
          aria-label={t('smart.add')}
          title={t('smart.add')}
        >
          <Plus size={14} strokeWidth={1.5} />
        </button>
      </div>

      {folders.map(folder => {
        const selected = location.pathname === `/smart/${folder.id}`
        return (
          <ContextMenu key={folder.id}>
            <ContextMenuTrigger asChild>
              <button
                type="button"
                onClick={() => { void navigate(`/smart/${folder.id}`); onNavigate?.() }}
                className={`w-full text-left px-2 py-1.5 rounded-lg text-sm flex items-center justify-between outline-none transition-colors hover:bg-hover-sidebar ${
                  selected ? 'font-medium text-accent' : 'text-text'
                }`}
              >
                <span className="flex items-center gap-2 min-w-0">
                  <FolderSearch size={16} strokeWidth={1.5} className="shrink-0" />
                  <span className="truncate">{folder.name}</span>
                </span>
                {folder.unread_count != null && folder.unread_count > 0 && (
                  <span
                    className="text-[11px] text-accent rounded-full px-1.5 leading-relaxed ml-2 shrink-0"
                    style={{ backgroundColor: 'color-mix(in srgb, var(--color-accent) 15%, transparent)' }}
                  >
                    {folder.unread_count}
                  </span>
                )}
              </button>
            </ContextMenuTrigger>
            <ContextMenuContent>
              <ContextMenuItem onSelect={() => setDialog({ mode: 'edit', folder })}>
                <Pencil size={16} strokeWidth={1.5} />
                {t('smart.edit')}
              </ContextMenuItem>
              <ContextMenuItem onSelect={() => setDeleting(folder)} className="text-error">
                <Trash2 size={16} strokeWidth={1.5} />
                {t('smart.delete')}
              </ContextMenuItem>
            </ContextMenuContent>
          </ContextMenu>
        )
      })}

      {dialog && (
        <SmartFolderDialog
          open
          mode={dialog.mode}
          initial={dialog.mode === 'edit' ? { name: dialog.folder.name, query: dialog.folder.query } : undefined}
          onOpenChange={open => { if (!open) setDialog(null) }}
          onSave={handleSave}
        />
      )}

      {deleting && (
        <ConfirmDialog
          title={t('smart.delete')}
          message={t('smart.deleteConfirm', { name: deleting.name })}
          confirmLabel={t('rules.delete')}
          danger
          onConfirm={() => { void handleDelete(deleting) }}
          onCancel={() => setDeleting(null)}
        />
      )}
    </>
  )
}
