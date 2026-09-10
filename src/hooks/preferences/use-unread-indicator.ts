import { createLocalStorageHook } from './create-local-storage-hook'

export type UnreadIndicator = 'on' | 'off'

const useHook = createLocalStorageHook<UnreadIndicator>('unread-indicator', 'on', ['on', 'off'])

export function useUnreadIndicator() {
  const [showUnreadIndicator, setShowUnreadIndicator] = useHook()
  return { showUnreadIndicator, setShowUnreadIndicator }
}
