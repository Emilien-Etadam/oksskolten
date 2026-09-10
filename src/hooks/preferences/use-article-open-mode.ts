import { createLocalStorageHook } from './create-local-storage-hook'

export type ArticleOpenMode = 'page' | 'overlay'

const useHook = createLocalStorageHook<ArticleOpenMode>('article-open-mode', 'page', ['page', 'overlay'])

export function useArticleOpenMode() {
  const [articleOpenMode, setArticleOpenMode] = useHook()
  return { articleOpenMode, setArticleOpenMode }
}
