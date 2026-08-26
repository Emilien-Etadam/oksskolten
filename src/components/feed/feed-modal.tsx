import { useState } from 'react'
import { useI18n } from '../../lib/i18n'
import { Dialog, DialogContent, DialogTitle } from '../ui/dialog'
import * as VisuallyHidden from '@radix-ui/react-visually-hidden'
import { IconButton } from '../ui/icon-button'
import { Rss, FolderPlus, Globe, ChevronLeft, X } from 'lucide-react'
import { FeedStep } from './feed-step'
import { FolderStep } from './folder-step'
import { ArticleStep } from './article-step'
import type { Category } from '../../../shared/types'

type ModalStep = 'select' | 'feed' | 'folder' | 'article'

interface FeedModalProps {
  onClose: () => void
  onCreated: () => void
  onCategoryCreated?: () => void
  onFetchStarted?: (feedId: number) => void
  onArticleCreated?: () => void
  categories?: Category[]
  /**
   * Step to open on. Defaults to the chooser; pass a step to go straight to it,
   * in which case the back arrow is hidden — there is no chooser to go back to.
   */
  initialStep?: ModalStep
}

function BackButton({ onClick }: { onClick: () => void }) {
  return (
    <IconButton size="sm" onClick={onClick}>
      <ChevronLeft size={16} strokeWidth={1.5} />
    </IconButton>
  )
}

export function FeedModal({ onClose, onCreated, onCategoryCreated, onFetchStarted, onArticleCreated, categories = [], initialStep = 'select' }: FeedModalProps) {
  const { t } = useI18n()
  const [step, setStep] = useState<ModalStep>(initialStep)

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent className="max-w-sm" aria-describedby={undefined}>
      <VisuallyHidden.Root asChild><DialogTitle>Modal</DialogTitle></VisuallyHidden.Root>
      {step === 'select' && (
        <>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-semibold">{t('modal.addNew')}</h2>
            <IconButton size="sm" onClick={onClose}>
              <X size={16} strokeWidth={1.5} />
            </IconButton>
          </div>
          <div className="space-y-2">
            <button
              onClick={() => setStep('feed')}
              className="w-full p-3 rounded-xl border border-border hover:border-accent hover:bg-hover transition-colors text-left flex items-center gap-3"
            >
              <div
                className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
                style={{ backgroundColor: 'color-mix(in srgb, var(--color-accent) 12%, transparent)' }}
              >
                <Rss size={18} strokeWidth={1.5} className="text-accent" />
              </div>
              <div>
                <div className="text-sm font-medium text-text">{t('modal.addFeedOption')}</div>
                <div className="text-xs text-muted">{t('modal.addFeedDesc')}</div>
              </div>
            </button>
            <button
              onClick={() => setStep('article')}
              className="w-full p-3 rounded-xl border border-border hover:border-accent hover:bg-hover transition-colors text-left flex items-center gap-3"
            >
              <div
                className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
                style={{ backgroundColor: 'color-mix(in srgb, var(--color-accent) 12%, transparent)' }}
              >
                <Globe size={18} strokeWidth={1.5} className="text-accent" />
              </div>
              <div>
                <div className="text-sm font-medium text-text">{t('modal.clipArticleOption')}</div>
                <div className="text-xs text-muted">{t('modal.clipArticleDesc')}</div>
              </div>
            </button>
            <button
              onClick={() => setStep('folder')}
              className="w-full p-3 rounded-xl border border-border hover:border-accent hover:bg-hover transition-colors text-left flex items-center gap-3"
            >
              <div
                className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
                style={{ backgroundColor: 'color-mix(in srgb, var(--color-accent) 12%, transparent)' }}
              >
                <FolderPlus size={18} strokeWidth={1.5} className="text-accent" />
              </div>
              <div>
                <div className="text-sm font-medium text-text">{t('modal.addFolderOption')}</div>
                <div className="text-xs text-muted">{t('modal.addFolderDesc')}</div>
              </div>
            </button>
          </div>
        </>
      )}

      {step === 'feed' && (
        <>
          <div className="flex items-center gap-2 mb-4">
            {initialStep === 'select' && <BackButton onClick={() => setStep('select')} />}
            <h2 className="text-base font-semibold">{t('modal.addFeed')}</h2>
          </div>
          <FeedStep
            onClose={onClose}
            onCreated={onCreated}
            onFetchStarted={onFetchStarted}
            categories={categories}
          />
        </>
      )}

      {step === 'article' && (
        <>
          <div className="flex items-center gap-2 mb-4">
            {initialStep === 'select' && <BackButton onClick={() => setStep('select')} />}
            <h2 className="text-base font-semibold">{t('feeds.clipArticle')}</h2>
          </div>
          <ArticleStep
            onClose={onClose}
            onCreated={onCreated}
            onArticleCreated={onArticleCreated}
          />
        </>
      )}

      {step === 'folder' && (
        <>
          <div className="flex items-center gap-2 mb-4">
            {initialStep === 'select' && <BackButton onClick={() => setStep('select')} />}
            <h2 className="text-base font-semibold">{t('modal.addFolder')}</h2>
          </div>
          <FolderStep
            onClose={onClose}
            onCategoryCreated={onCategoryCreated}
          />
        </>
      )}
      </DialogContent>
    </Dialog>
  )
}
