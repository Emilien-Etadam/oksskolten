import { createLocalStorageHook } from './create-local-storage-hook'

export type ShowFeedActivity = 'on' | 'off'

const useHook = createLocalStorageHook<ShowFeedActivity>('show-feed-activity', 'on', ['on', 'off'])

export function useShowFeedActivity() {
  const [showFeedActivity, setShowFeedActivity] = useHook()
  return { showFeedActivity, setShowFeedActivity }
}
