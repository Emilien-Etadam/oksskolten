import { createLocalStorageHook } from './create-local-storage-hook'

export type AutoMarkRead = 'on' | 'off'

const useHook = createLocalStorageHook<AutoMarkRead>('auto-mark-read', 'off', ['on', 'off'])

export function useAutoMarkRead() {
  const [autoMarkRead, setAutoMarkRead] = useHook()
  return { autoMarkRead, setAutoMarkRead }
}
