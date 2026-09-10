import { createLocalStorageHook } from './create-local-storage-hook'

export type InternalLinks = 'on' | 'off'

const useHook = createLocalStorageHook<InternalLinks>('internal-links', 'off', ['on', 'off'])

export function useInternalLinks() {
  const [internalLinks, setInternalLinks] = useHook()
  return { internalLinks, setInternalLinks }
}
