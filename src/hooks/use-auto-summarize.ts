import { createLocalStorageHook } from './create-local-storage-hook'

export type AutoSummarize = 'on' | 'off'

const useHook = createLocalStorageHook<AutoSummarize>('auto-summarize', 'off', ['on', 'off'])

export function useAutoSummarize() {
  const [autoSummarize, setAutoSummarize] = useHook()
  return { autoSummarize, setAutoSummarize }
}
