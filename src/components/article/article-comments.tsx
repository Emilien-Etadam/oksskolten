import { useMemo } from 'react'
import useSWR from 'swr'
import { ArrowBigUp } from 'lucide-react'
import { fetcher } from '../../lib/fetcher'
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

/** Client-side mirror of the server's provider detection, to skip useless requests. */
export function hasCommentsProvider(articleUrl: string): boolean {
  try {
    const host = new URL(articleUrl).hostname.replace(/^(www|old|new)\./, '')
    return host === 'reddit.com'
  } catch {
    return false
  }
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

  if (!enabled) return null
  if (!isLoading && (!data || data.comments.length === 0)) return null

  return (
    <section className="mt-8 border-t border-border pt-5">
      <h2 className="text-[15px] font-semibold text-text">{t('comments.title')}</h2>
      {isLoading ? (
        <div className="mt-4 space-y-3">
          <Skeleton className="h-3.5 w-1/4" />
          <Skeleton className="h-3.5 w-full" />
          <Skeleton className="h-3.5 w-2/3" />
        </div>
      ) : (
        data!.comments.map((comment, i) => <CommentItem key={i} comment={comment} />)
      )}
    </section>
  )
}
