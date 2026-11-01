import { createLocalStorageHook } from './create-local-storage-hook'

export type SimpleMode = 'on' | 'off'

/**
 * Simple mode trims the navigation down to the essentials (themes,
 * bookmarks, clips, GitHub releases, settings). The hidden pages keep
 * working by URL; turning the mode off brings the full sidebar back.
 */
const useHook = createLocalStorageHook<SimpleMode>('simple-mode', 'on', ['on', 'off'])

export function useSimpleMode() {
  const [simpleMode, setSimpleMode] = useHook()
  return { simpleMode, setSimpleMode }
}
