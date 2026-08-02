import { createLocalStorageHook } from './create-local-storage-hook'

export type HideSidebar = 'on' | 'off'

const STORAGE_KEY = 'hide-sidebar'

const useHook = createLocalStorageHook<HideSidebar>(STORAGE_KEY, 'off', ['on', 'off'])

/** Non-hook read for code that runs outside React state (initial layout decisions). */
export function isSidebarHidden(): boolean {
  return localStorage.getItem(STORAGE_KEY) === 'on'
}

/**
 * When 'on', the sidebar never opens automatically on desktop — navigation
 * happens through the bottom tab bar, newspaper-app style. The Menu tab
 * still opens the sidebar on demand.
 */
export function useHideSidebar() {
  const [hideSidebar, setHideSidebar] = useHook()
  return { hideSidebar, setHideSidebar }
}
