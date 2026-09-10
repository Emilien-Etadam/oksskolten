import { useState, useEffect, useCallback } from 'react'
import { resolveHighlightCss } from '../../data/highlightThemes'

const LS_KEY = 'highlight-theme-override'
const LINK_ID = 'hljs-theme-link'

export const HIGHLIGHT_NONE = 'none'
const FALLBACK_FAMILY = 'github'

function getInitialOverride(): string | null {
  return localStorage.getItem(LS_KEY) || null
}

function applyLink(cssStem: string) {
  let link = document.getElementById(LINK_ID) as HTMLLinkElement | null
  if (!link) {
    link = document.createElement('link')
    link.id = LINK_ID
    link.rel = 'stylesheet'
    document.head.appendChild(link)
  }
  link.href = `/hljs-themes/${cssStem}.min.css`
}

/**
 * @param defaultFamily - the highlight family key from the current app theme (Theme.highlight)
 * @param isDark - current color mode
 */
export function useHighlightTheme(defaultFamily: string, isDark: boolean) {
  const [override, setOverrideState] = useState<string | null>(getInitialOverride)

  const familyKey = override || defaultFamily || FALLBACK_FAMILY
  const effectiveCss = familyKey === HIGHLIGHT_NONE
    ? HIGHLIGHT_NONE
    : resolveHighlightCss(familyKey, isDark)

  useEffect(() => {
    applyLink(effectiveCss)
  }, [effectiveCss])

  const setHighlightTheme = useCallback((value: string | null) => {
    setOverrideState(value)
    if (value) {
      localStorage.setItem(LS_KEY, value)
    } else {
      localStorage.removeItem(LS_KEY)
    }
  }, [])

  return {
    highlightTheme: familyKey,
    highlightThemeOverride: override,
    setHighlightTheme,
  }
}
