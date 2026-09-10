import { useState, useEffect, useSyncExternalStore } from 'react'

type ColorMode = 'light' | 'dark' | 'system'

function getStoredMode(): ColorMode {
  const stored = localStorage.getItem('theme')
  if (stored === 'dark' || stored === 'light') return stored
  return 'system'
}

function getSystemDark(): boolean {
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

function subscribeSystemDark(callback: () => void) {
  const mql = window.matchMedia('(prefers-color-scheme: dark)')
  mql.addEventListener('change', callback)
  return () => mql.removeEventListener('change', callback)
}

export function useDarkMode() {
  const [colorMode, setColorMode] = useState<ColorMode>(getStoredMode)
  const systemDark = useSyncExternalStore(subscribeSystemDark, getSystemDark)

  const isDark = colorMode === 'system' ? systemDark : colorMode === 'dark'

  useEffect(() => {
    const root = document.documentElement
    if (isDark) {
      root.classList.add('dark')
    } else {
      root.classList.remove('dark')
    }
    root.style.colorScheme = isDark ? 'dark' : 'light'
  }, [isDark])

  useEffect(() => {
    localStorage.setItem('theme', colorMode)
  }, [colorMode])

  return { isDark, colorMode, setColorMode }
}
