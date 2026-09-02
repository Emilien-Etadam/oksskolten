import useSWR from 'swr'
import { fetcher } from '../../lib/fetcher'
import { useI18n } from '../../lib/i18n'
import { hasCommentsProvider, type ArticleComment } from './article-comments'
import type { Article } from '../../../shared/types'

interface ArticleRawPageProps {
  articleUrl: string
}

/** Serialize the comment thread as Markdown, replies nested as blockquotes. */
export function commentsToMarkdown(comments: ArticleComment[], heading: string): string {
  const lines: string[] = ['', '---', '', `## ${heading}`]
  const walk = (list: ArticleComment[], depth: number) => {
    const prefix = '> '.repeat(depth)
    const blank = prefix.trim()
    for (const comment of list) {
      lines.push(blank, `${prefix}**${comment.author}** · ↑${comment.score}`, blank)
      for (const line of comment.body.split('\n')) lines.push(`${prefix}${line}`)
      walk(comment.replies, depth + 1)
    }
  }
  walk(comments, 0)
  return lines.join('\n') + '\n'
}

export function ArticleRawPage({ articleUrl }: ArticleRawPageProps) {
  const { t } = useI18n()
  const { data: article } = useSWR<Pick<Article, 'id' | 'full_text'>>(
    `/api/articles/by-url?url=${encodeURIComponent(articleUrl)}`,
    fetcher,
  )

  const { data: commentsData } = useSWR<{ comments: ArticleComment[] }>(
    article && hasCommentsProvider(articleUrl) ? `/api/articles/${article.id}/comments` : null,
    fetcher,
    { revalidateOnFocus: false },
  )

  if (!article) return null

  const comments = commentsData?.comments ?? []
  const text = (article.full_text || '')
    + (comments.length > 0 ? commentsToMarkdown(comments, t('comments.title')) : '')

  return (
    <pre className="min-h-screen bg-bg text-text p-6 md:p-10 whitespace-pre-wrap break-words font-mono text-sm leading-relaxed m-0">
      {text}
    </pre>
  )
}
