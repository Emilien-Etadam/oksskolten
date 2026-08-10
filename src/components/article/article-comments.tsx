import { useMemo, useState } from 'react'
import useSWR from 'swr'
import { ArrowBigUp } from 'lucide-react'
import { fetcher, authHeaders } from '../../lib/fetcher'
import { renderMarkdown } from '../../lib/markdown'
import { sanitizeHtml } from '../../lib/sanitize'
import { useI18n } from '../../lib/i18n'
import { Skeleton } from '../ui/skeleton'

interface ArticleComment {
  author: string
  score: number
  body: string
  replies: ArticleComment[]
}

interface CommentsResponse {
  provider: string | null
  comments: ArticleComment[]
}

/** Local LLM translation of a whole thread can exceed the default API timeout */
const TRANSLATE_TIMEOUT_MS = 120_000

/** Client-side mirror of the server's provider detection, to skip useless requests. */
export function hasCommentsProvider(articleUrl: string): boolean {
  try {
    const host = new URL(articleUrl).hostname.replace(/^(www|old|new)\./, '')
    return host === 'reddit.com'
  } catch {
    return false
  }
}

/** Depth-first comment bodies, in the same order applyTranslations consumes them. */
function flattenBodies(comments: ArticleComment[]): string[] {
  const out: string[] = []
  const walk = (list: ArticleComment[]) => {
    for (const comment of list) {
      out.push(comment.body)
      walk(comment.replies)
    }
  }
  walk(comments)
  return out
}

function applyTranslations(comments: ArticleComment[], translations: string[]): ArticleComment[] {
  let i = 0
  const walk = (list: ArticleComment[]): ArticleComment[] => list.map(comment => {
    const body = translations[i++] ?? comment.body
    return { ...comment, body, replies: walk(comment.replies) }
  })
  return walk(comments)
}

function CommentBody({ body }: { body: string }) {
  const html = useMemo(() => sanitizeHtml(renderMarkdown(body)), [body])
  return (
    <div
      className="prose text-[13.5px] [&_p]:my-1.5 break-words [overflow-wrap:anywhere]"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}

function CommentItem({ comment, depth = 0 }: { comment: ArticleComment; depth?: number }) {
  return (
    <div className={depth > 0 ? 'ml-3 mt-2 border-l-2 border-border pl-3' : 'mt-4'}>
      <div className="flex items-center gap-2 text-[12px] text-muted">
        <span className="font-medium text-text">{comment.author}</span>
        <span className="flex items-center gap-0.5">
          <ArrowBigUp className="w-3.5 h-3.5" />
          {comment.score}
        </span>
      </div>
      <CommentBody body={comment.body} />
      {comment.replies.map((reply, i) => (
        <CommentItem key={i} comment={reply} depth={depth + 1} />
      ))}
    </div>
  )
}

/**
 * Top comments fetched from the article's discussion platform (Reddit),
 * shown below the article body. Renders nothing for unsupported sources
 * or when no comments could be fetched.
 */
export function ArticleComments({ articleId, articleUrl }: { articleId: number; articleUrl: string }) {
  const { t } = useI18n()
  const enabled = hasCommentsProvider(articleUrl)
  const { data, isLoading } = useSWR<CommentsResponse>(
    enabled ? `/api/articles/${articleId}/comments` : null,
    fetcher,
    { revalidateOnFocus: false },
  )

  const [translations, setTranslations] = useState<string[] | null>(null)
  const [showTranslated, setShowTranslated] = useState(false)
  const [translating, setTranslating] = useState(false)

  if (!enabled) return null
  if (!isLoading && (!data || data.comments.length === 0)) return null

  const comments = data?.comments ?? []
  const displayed = showTranslated && translations
    ? applyTranslations(comments, translations)
    : comments

  const handleTranslate = async () => {
    if (translations) {
      setShowTranslated(prev => !prev)
      return
    }
    setTranslating(true)
    try {
      const res = await fetch('/api/comments/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ texts: flattenBodies(comments) }),
        signal: AbortSignal.timeout(TRANSLATE_TIMEOUT_MS),
      })
      if (!res.ok) throw new Error(`translate failed: ${res.status}`)
      const payload = await res.json() as { translations: string[] }
      setTranslations(payload.translations)
      setShowTranslated(true)
    } catch {
      // Leave the originals displayed; the user can retry
    } finally {
      setTranslating(false)
    }
  }

  return (
    <section className="mt-8 border-t border-border pt-5">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-[15px] font-semibold text-text">{t('comments.title')}</h2>
        {comments.length > 0 && (
          <button
            type="button"
            onClick={() => { void handleTranslate() }}
            disabled={translating}
            className="text-[12.5px] text-accent hover:underline disabled:opacity-50 shrink-0"
          >
            {translating ? `${t('article.translate')}…` : showTranslated ? t('article.original') : t('article.translate')}
          </button>
        )}
      </div>
      {isLoading ? (
        <div className="mt-4 space-y-3">
          <Skeleton className="h-3.5 w-1/4" />
          <Skeleton className="h-3.5 w-full" />
          <Skeleton className="h-3.5 w-2/3" />
        </div>
      ) : (
        displayed.map((comment, i) => <CommentItem key={i} comment={comment} />)
      )}
    </section>
  )
}
