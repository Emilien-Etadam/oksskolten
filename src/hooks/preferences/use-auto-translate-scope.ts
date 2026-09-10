import { createLocalStorageHook } from './create-local-storage-hook'

/** Mirrors AutoTranslateScope in server/fetcher/ai-queue.ts. */
export type AutoTranslateScope = 'full' | 'titles'

const useHook = createLocalStorageHook<AutoTranslateScope>(
  'auto-translate-scope',
  'full',
  ['full', 'titles'],
)

export function useAutoTranslateScope() {
  const [autoTranslateScope, setAutoTranslateScope] = useHook()
  return { autoTranslateScope, setAutoTranslateScope }
}
