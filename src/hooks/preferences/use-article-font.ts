import { useState, useEffect, useCallback } from 'react'
import { findArticleFont } from '../../data/articleFonts'

const LS_KEY = 'article-font'
const LINK_ID = 'article-font-link'

function getInitialValue(): string {
  return localStorage.getItem(LS_KEY) || 'system'
}

export function useArticleFont() {
  const [articleFont, setArticleFontState] = useState<string>(getInitialValue)

  const font = findArticleFont(articleFont)

  // Apply CSS custom property and load Google Font
  useEffect(() => {
    document.documentElement.style.setProperty('--font-article', font.family)

    // Manage Google Fonts <link>
    const existing = document.getElementById(LINK_ID) as HTMLLinkElement | null
    if (font.googleFontsUrl) {
      if (existing) {
        existing.href = font.googleFontsUrl
      } else {
        const link = document.createElement('link')
        link.id = LINK_ID
        link.rel = 'stylesheet'
        link.href = font.googleFontsUrl
        document.head.appendChild(link)
      }
    } else if (existing) {
      existing.remove()
    }
  }, [font])

  const setArticleFont = useCallback((value: string) => {
    setArticleFontState(value)
    if (value && value !== 'system') {
      localStorage.setItem(LS_KEY, value)
    } else {
      localStorage.removeItem(LS_KEY)
    }
  }, [])

  return { articleFont: articleFont, setArticleFont }
}
