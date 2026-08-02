const STORAGE_KEY = 'sidebar-collapsed'

/** Whether the user last collapsed the sidebar on desktop. */
export function isSidebarCollapsed(): boolean {
  return localStorage.getItem(STORAGE_KEY) === '1'
}

/** Persist the desktop collapse state so it survives reloads. */
export function persistSidebarCollapsed(collapsed: boolean): void {
  localStorage.setItem(STORAGE_KEY, collapsed ? '1' : '0')
}
