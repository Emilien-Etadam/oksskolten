import { createLocalStorageHook } from './create-local-storage-hook'

export type AutoTranslate = 'on' | 'off'

const useHook = createLocalStorageHook<AutoTranslate>('auto-translate', 'off', ['on', 'off'])

export function useAutoTranslate() {
  const [autoTranslate, setAutoTranslate] = useHook()
  return { autoTranslate, setAutoTranslate }
}
