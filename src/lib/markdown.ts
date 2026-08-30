import { Marked } from 'marked'
import { markedHighlight } from 'marked-highlight'
import hljs from 'highlight.js/lib/core'
import { collapseMultilineLinks, walkLinks } from '../../shared/markdown-links'

// Register languages individually to keep bundle size small
import javascript from 'highlight.js/lib/languages/javascript'
import typescript from 'highlight.js/lib/languages/typescript'
import python from 'highlight.js/lib/languages/python'
import go from 'highlight.js/lib/languages/go'
import rust from 'highlight.js/lib/languages/rust'
import bash from 'highlight.js/lib/languages/bash'
import json from 'highlight.js/lib/languages/json'
import yaml from 'highlight.js/lib/languages/yaml'
import xml from 'highlight.js/lib/languages/xml'
import css from 'highlight.js/lib/languages/css'
import sql from 'highlight.js/lib/languages/sql'
import java from 'highlight.js/lib/languages/java'
import cpp from 'highlight.js/lib/languages/cpp'
import c from 'highlight.js/lib/languages/c'
import ruby from 'highlight.js/lib/languages/ruby'
import php from 'highlight.js/lib/languages/php'
import diff from 'highlight.js/lib/languages/diff'
import markdown from 'highlight.js/lib/languages/markdown'
import swift from 'highlight.js/lib/languages/swift'
import kotlin from 'highlight.js/lib/languages/kotlin'
import dockerfile from 'highlight.js/lib/languages/dockerfile'
import ini from 'highlight.js/lib/languages/ini'
import makefile from 'highlight.js/lib/languages/makefile'
import shell from 'highlight.js/lib/languages/shell'
import plaintext from 'highlight.js/lib/languages/plaintext'

hljs.registerLanguage('javascript', javascript)
hljs.registerLanguage('typescript', typescript)
hljs.registerLanguage('python', python)
hljs.registerLanguage('go', go)
hljs.registerLanguage('rust', rust)
hljs.registerLanguage('bash', bash)
hljs.registerLanguage('json', json)
hljs.registerLanguage('yaml', yaml)
hljs.registerLanguage('xml', xml)
hljs.registerLanguage('css', css)
hljs.registerLanguage('sql', sql)
hljs.registerLanguage('java', java)
hljs.registerLanguage('cpp', cpp)
hljs.registerLanguage('c', c)
hljs.registerLanguage('ruby', ruby)
hljs.registerLanguage('php', php)
hljs.registerLanguage('diff', diff)
hljs.registerLanguage('markdown', markdown)
hljs.registerLanguage('swift', swift)
hljs.registerLanguage('kotlin', kotlin)
hljs.registerLanguage('dockerfile', dockerfile)
hljs.registerLanguage('ini', ini)
hljs.registerLanguage('makefile', makefile)
hljs.registerLanguage('shell', shell)
hljs.registerLanguage('plaintext', plaintext)

// Common aliases
hljs.registerAliases(['js', 'jsx'], { languageName: 'javascript' })
hljs.registerAliases(['ts', 'tsx'], { languageName: 'typescript' })
hljs.registerAliases(['sh', 'zsh'], { languageName: 'bash' })
hljs.registerAliases(['yml'], { languageName: 'yaml' })
hljs.registerAliases(['html'], { languageName: 'xml' })

export { walkLinks }

function altFromImgTag(imgTag: string): string {
  const altMatch = imgTag.match(/alt=["']([^"']*)["']/i)
  return altMatch?.[1] ?? ''
}

/**
 * Rewrite <picture> blocks to markdown images without nested `[\s\S]*?`
 * regexes. Firefox's regex engine recurses on those and throws
 * InternalError: too much recursion on a large unclosed tag.
 */
function rewritePictureElements(s: string): string {
  const startRe = /<picture[^>]*>/gi
  const out: string[] = []
  let pos = 0
  let match: RegExpExecArray | null
  while ((match = startRe.exec(s)) !== null) {
    const tagStart = match.index
    const tagEnd = tagStart + match[0].length
    const closeRel = s.slice(tagEnd).toLowerCase().indexOf('</picture>')
    if (closeRel === -1) break
    const innerEnd = tagEnd + closeRel
    const picEnd = innerEnd + '</picture>'.length
    const inner = s.slice(tagEnd, innerEnd)
    const imgMatch = inner.match(/<img\s[^>]*src=["']([^"']*)["'][^>]*>/i)
    startRe.lastIndex = picEnd
    if (!imgMatch) continue

    const src = imgMatch[1]
    const alt = altFromImgTag(imgMatch[0])

    let bracket = tagStart - 1
    while (bracket >= pos && /\s/.test(s[bracket])) bracket--
    const linked = bracket >= pos && s[bracket] === '[' && (bracket === 0 || s[bracket - 1] !== '!')
    const closeLink = linked ? s.slice(picEnd).match(/^\s*\]\s*\(([^)]*)\)/) : null

    if (closeLink) {
      out.push(s.slice(pos, bracket))
      out.push(`[![${alt}](${src})](${closeLink[1]})`)
      pos = picEnd + closeLink[0].length
      startRe.lastIndex = pos
    } else {
      out.push(s.slice(pos, tagStart))
      out.push(`![${alt}](${src})`)
      pos = picEnd
    }
  }
  out.push(s.slice(pos))
  return out.join('')
}

function escapeAsPre(text: string): string {
  return `<pre>${text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</pre>`
}

/**
 * Fix malformed markdown in legacy stored content.
 * New content is normalized server-side before storage; this function exists solely
 * to repair articles saved before those server-side fixes were in place.
 *
 * Repairs applied:
 *  1. [<picture>...<img src>...</picture>](url) → [![alt](src)](url)
 *  2. Standalone <picture>...</picture>         → ![alt](src)
 *  3. Stray <source> tags                       → removed
 *  4. [\n![alt](src)\n](url)                    → [![alt](src)](url)
 *  5. [text\nwith\nnewlines](url)               → [text with newlines](url)
 *
 * Fenced code blocks are preserved untouched.
 */
export function fixLegacyMarkdown(md: string): string {
  // Split on fenced code blocks to avoid transforming HTML examples inside them.
  // Odd-indexed segments are code block content; only process even-indexed (prose) segments.
  const parts = md.split(/(```[\s\S]*?```|~~~[\s\S]*?~~~)/g)
  for (let i = 0; i < parts.length; i += 2) {
    let s = parts[i]
    if (/<picture/i.test(s)) s = rewritePictureElements(s)
    if (/<source/i.test(s)) s = s.replace(/<source\s[^>]*>/gi, '')
    s = collapseMultilineLinks(s)
    parts[i] = s
  }
  return parts.join('')
}

/**
 * Escape square brackets inside markdown link text so that titles like
 * `[AINews] Foo` don't break `[text](url)` syntax.
 * Fenced code blocks are preserved untouched.
 */
export function escapeNestedBrackets(md: string): string {
  const parts = md.split(/(```[\s\S]*?```|~~~[\s\S]*?~~~)/g)
  for (let i = 0; i < parts.length; i += 2) {
    parts[i] = walkLinks(parts[i], (text, url) => {
      if (text.includes('[') || text.includes(']')) {
        const escaped = text.replace(/\[/g, '\\[').replace(/\]/g, '\\]')
        return `[${escaped}](${url})`
      }
      return null
    })
  }
  return parts.join('')
}

export const markedInstance = new Marked(
  { gfm: true, breaks: true },
  markedHighlight({
    emptyLangClass: 'hljs',
    langPrefix: 'hljs language-',
    highlight(code, lang) {
      const language = lang && hljs.getLanguage(lang) ? lang : 'plaintext'
      try {
        return hljs.highlight(code, { language, ignoreIllegals: true }).value
      } catch {
        return code
      }
    },
  }),
)

export type MarkdownPreprocessor = (md: string) => string

/** Preprocessors applied to every renderMarkdown call */
const defaultPipeline: MarkdownPreprocessor[] = [fixLegacyMarkdown, escapeNestedBrackets]

/**
 * Render markdown to HTML with pre-processing pipeline.
 * Default preprocessors (e.g. bracket escaping) always run.
 * Pass additional context-specific preprocessors via the second argument.
 *
 * @example
 *   renderMarkdown(md)                            // article body, summary
 *   renderMarkdown(md, [rewriteLinksToAppPaths])  // chat (with URL rewriting)
 */
export function renderMarkdown(md: string, preprocessors?: MarkdownPreprocessor[]): string {
  try {
    const pipeline = preprocessors
      ? [...preprocessors, ...defaultPipeline]
      : defaultPipeline
    const processed = pipeline.reduce((text, fn) => fn(text), md)
    const html = markedInstance.parse(processed)
    return typeof html === 'string' ? html : escapeAsPre(md)
  } catch {
    return escapeAsPre(md)
  }
}
