import { createLocalStorageHook } from './create-local-storage-hook'

export type ShowThumbnails = 'on' | 'off'

const useHook = createLocalStorageHook<ShowThumbnails>('show-thumbnails', 'on', ['on', 'off'])

export function useShowThumbnails() {
  const [showThumbnails, setShowThumbnails] = useHook()
  return { showThumbnails, setShowThumbnails }
}
