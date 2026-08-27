#!/usr/bin/env node --import tsx
/**
 * Diagnose why an article extracts to empty or truncated text.
 *
 * Walks the same phases as `contentWorker.parseHtml()` — pre-clean,
 * Readability, post-clean (exact selectors, partial patterns, scoring,
 * normalization) — printing the surviving text length after each one, so a
 * drop to zero can be attributed to a specific phase and, for partial
 * patterns, to the individual pattern that matched.
 *
 * The instrumented walk is a faithful copy of the worker's sequence, not the
 * worker itself. As a cross-check the script finishes by calling the real
 * `parseHtml()` twice — once with the production config, once with partial
 * patterns disabled — so the reported numbers can be compared against
 * `length(full_text)` in the database.
 *
 * Usage:
 *   node --import tsx scripts/debug-extract.ts <url>
 *   node --import tsx scripts/debug-extract.ts --file page.html [--url <url>]
 *   node --import tsx scripts/debug-extract.ts <url> --dump-html out.html
 */
import fs from 'node:fs'
import { JSDOM } from 'jsdom'
import { Readability } from '@mozilla/readability'
import { fetchHtml } from '../server/fetcher/http.js'
import { stripHeavyTags, extractAnchoredContentHtml, MIN_EXTRACTED_LENGTH } from '../server/fetcher/content.js'
import { parseHtml } from '../server/fetcher/contentWorker.js'
import { preClean } from '../server/lib/cleaner/index.js'
import { findBestContentBlock, scoreAndRemoveNonContent } from '../server/lib/cleaner/content-scorer.js'
import { normalizeHtml } from '../server/lib/cleaner/html-normalizer.js'
import { removeBySelectors } from '../server/lib/cleaner/selector-remover.js'
import {
  buildPipelineConfig,
  TEST_ATTRIBUTES,
  ALLOWED_EMPTY_ELEMENTS,
  type CleanerConfig,
} from '../server/lib/cleaner/selectors.js'

interface Args {
  url: string
  file: string | null
  dumpHtml: string | null
}

function parseArgs(argv: string[]): Args {
  let url = ''
  let file: string | null = null
  let dumpHtml: string | null = null

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--file') file = argv[++i]
    else if (arg === '--url') url = argv[++i]
    else if (arg === '--dump-html') dumpHtml = argv[++i]
    else if (!arg.startsWith('-')) url = arg
  }

  if (!url && !file) {
    console.error('usage: debug-extract.ts <url> | --file <path> [--url <url>] [--dump-html <path>]')
    process.exit(2)
  }
  // Readability and the cleaners resolve relative URLs against a base, so a
  // file-only run still needs a plausible document URL.
  if (!url) url = 'https://example.com/'
  return { url, file, dumpHtml }
}

/** Visible-text length, measured the way the pipeline's own thresholds do. */
function textLen(node: { textContent: string | null } | null): number {
  return (node?.textContent || '').replace(/\s+/g, ' ').trim().length
}

function fmt(n: number): string {
  return n.toLocaleString('en-US')
}

/**
 * Render an element as an opening tag carrying only the attributes the partial
 * matcher looks at. Readability strips class and id, so a bare `<div>` would
 * otherwise be unidentifiable in the removal report.
 */
function describe(el: Element): string {
  const attrs = TEST_ATTRIBUTES.map(attr => {
    const value = attr === 'class'
      ? (typeof el.className === 'string' ? el.className : '')
      : attr === 'id'
        ? el.id
        : el.getAttribute(attr)
    return value ? ` ${attr}="${value}"` : ''
  }).join('')
  return `<${el.tagName.toLowerCase()}${attrs}>`
}

/** Concatenated attribute values a partial pattern is tested against. */
function combinedAttrs(el: Element): string {
  return TEST_ATTRIBUTES.map(attr => {
    if (attr === 'class') return typeof el.className === 'string' ? el.className : ''
    if (attr === 'id') return el.id || ''
    return el.getAttribute(attr) || ''
  })
    .join(' ')
    .toLowerCase()
}

/**
 * Report which partial patterns would remove which elements, mirroring
 * `removeBySelectors()`'s matching so the attribution stays accurate.
 *
 * Only outermost matches are reported: a match nested inside another match is
 * removed as a side effect of its ancestor, so counting its text separately
 * would double-count the loss.
 *
 * Note that Readability strips `class` and `id` from its own output, so on the
 * normal path these patterns can only fire on surviving `data-*` attributes.
 * They regain their full reach when `findBestContentBlock` substitutes a raw
 * `innerHTML` block, which keeps the site's original attributes.
 */
function explainPartialMatches(doc: Document, patterns: string[], substituted: boolean): void {
  const attrSelector = TEST_ATTRIBUTES.map(a => `[${a}]`).join(',')
  const matched = new Map<Element, string[]>()

  for (const el of doc.querySelectorAll(attrSelector)) {
    const combined = combinedAttrs(el)
    if (!combined.trim()) continue
    const hits = patterns.filter(p => new RegExp(p, 'i').test(combined))
    if (hits.length > 0) matched.set(el, hits)
  }

  const outermost = [...matched.keys()].filter(el => {
    for (let p = el.parentElement; p; p = p.parentElement) {
      if (matched.has(p)) return false
    }
    return true
  })

  if (outermost.length === 0) {
    const why = substituted
      ? ''
      : ' — Readability had already stripped class/id, so only data-* was testable'
    console.log(`      (no partial pattern matched${why})`)
    return
  }

  outermost
    .map(el => ({ el, lost: textLen(el), hits: matched.get(el)! }))
    .sort((a, b) => b.lost - a.lost)
    .forEach(({ el, lost, hits }) => {
      const via = hits.map(h => `'${h}'`).join(', ')
      console.log(`      - ${describe(el)} — ${fmt(lost)} chars, matched by ${via}`)
    })
}

async function main(): Promise<void> {
  const { url, file, dumpHtml } = parseArgs(process.argv.slice(2))

  const rawHtml = file
    ? fs.readFileSync(file, 'utf-8')
    : (await fetchHtml(url)).html

  console.log(`URL:    ${url}`)
  if (file) console.log(`FILE:   ${file}`)
  console.log('')
  console.log(`1. source HTML            ${fmt(rawHtml.length)} chars`)

  const anchored = extractAnchoredContentHtml(rawHtml, url)
  const stripped = stripHeavyTags(anchored)
  console.log(`2. stripHeavyTags         ${fmt(stripped.length)} chars`)

  // Phase 1: pre-clean, on its own DOM (the worker keeps this one around for
  // the content-block cross-check below).
  const cleaningDom = new JSDOM(stripped, { url })
  const beforePre = textLen(cleaningDom.window.document.body)
  preClean(cleaningDom.window.document)
  console.log(`3. preClean               ${fmt(beforePre)} -> ${fmt(textLen(cleaningDom.window.document.body))} chars of text`)

  // Phase 2: Readability, plus the content-block override the worker applies
  // when a denser block beats Readability's pick by more than 2x.
  const readabilityDom = new JSDOM(cleaningDom.serialize(), { url })
  const article = new Readability(readabilityDom.window.document).parse()
  let contentHtml = article?.content || null
  const readabilityLen = (article?.textContent || '').replace(/\s+/g, ' ').trim().length
  console.log(`4. Readability            ${fmt(readabilityLen)} chars  title=${JSON.stringify(article?.title ?? null)}`)

  const bestBlock = findBestContentBlock(cleaningDom.window.document)
  let substituted = false
  if (bestBlock && bestBlock.pRatio > 0.3) {
    const bestLen = textLen(bestBlock.el)
    substituted = bestLen > readabilityLen * 2
    console.log(
      `   best content block     ${describe(bestBlock.el)} ${fmt(bestLen)} chars, pRatio=${bestBlock.pRatio.toFixed(2)}` +
        ` — ${substituted ? 'SUBSTITUTED for Readability output' : 'not substituted'}`,
    )
    if (substituted) contentHtml = bestBlock.el.innerHTML
  }

  if (!contentHtml) {
    console.log('')
    console.log('VERDICT: Readability extracted nothing — the worker throws here and the')
    console.log('         article is stored with last_error set. A NULL last_error in the')
    console.log('         database means this is not the failing phase.')
    return
  }

  // Phase 3: post-clean, one step at a time.
  const contentDom = new JSDOM(contentHtml, { url })
  const contentDoc = contentDom.window.document
  const pipeline = buildPipelineConfig()
  console.log('5. postClean')

  const afterReadability = textLen(contentDoc.body)
  removeBySelectors(contentDoc, { exactSelectors: pipeline.postCleanSelectors })
  const afterExact = textLen(contentDoc.body)
  console.log(`   a. exact selectors     ${fmt(afterReadability)} -> ${fmt(afterExact)} chars`)

  explainPartialMatches(contentDoc, pipeline.partialSelectors, substituted)
  removeBySelectors(contentDoc, {
    exactSelectors: [],
    partialSelectors: pipeline.partialSelectors,
    testAttributes: TEST_ATTRIBUTES,
  })
  const afterPartial = textLen(contentDoc.body)
  console.log(`   b. partial patterns    ${fmt(afterExact)} -> ${fmt(afterPartial)} chars`)

  scoreAndRemoveNonContent(contentDoc, { thresholdOffset: pipeline.scoringThresholdOffset })
  const afterScoring = textLen(contentDoc.body)
  console.log(`   c. scoring             ${fmt(afterPartial)} -> ${fmt(afterScoring)} chars`)

  normalizeHtml(contentDoc, contentDoc.body, {
    allowedAttributes: pipeline.allowedAttributes,
    allowedEmptyElements: ALLOWED_EMPTY_ELEMENTS,
  })
  console.log(`   d. normalization       ${fmt(afterScoring)} -> ${fmt(textLen(contentDoc.body))} chars`)

  if (dumpHtml) {
    fs.writeFileSync(dumpHtml, contentHtml, 'utf-8')
    console.log(`\n   Readability output written to ${dumpHtml}`)
  }

  // Cross-check against the real worker, toggling one cleaning stage at a
  // time. `production` is the number that lands in articles.full_text; any
  // variant that beats it names the stage responsible for the loss.
  const variants: Array<{ label: string; config?: CleanerConfig }> = [
    { label: 'production', config: undefined },
    { label: 'no exact selectors', config: { disablePostCleanSelectors: true } },
    { label: 'no partial patterns', config: { disablePartialSelectors: true } },
    { label: 'no scoring', config: { disableScoring: true } },
    { label: 'no normalization', config: { disableNormalization: true } },
    { label: 'no pre-clean', config: { disablePreClean: true } },
  ]

  console.log('')
  console.log('6. parseHtml with each cleaning stage disabled')
  const results = variants.map(v => {
    let len = -1
    try {
      len = parseHtml({ html: stripped, articleUrl: url, cleanerConfig: v.config }).fullText.length
    } catch {
      // Readability throws when nothing survives; report it rather than abort.
    }
    const shown = len < 0 ? 'threw (no content)' : `${fmt(len)} chars of markdown`
    console.log(`   ${v.label.padEnd(22)} ${shown}`)
    return { ...v, len }
  })

  const production = results[0].len
  const rescued = results.slice(1).filter(r => r.len > production && r.len >= MIN_EXTRACTED_LENGTH)

  console.log('')
  if (production >= MIN_EXTRACTED_LENGTH) {
    console.log('VERDICT: extraction succeeds here. If the stored article is empty, it was')
    console.log('         fetched under different conditions (bot block, redirect, or a')
    console.log('         since-changed page) — re-fetch the article and compare.')
  } else if (beforePre < MIN_EXTRACTED_LENGTH) {
    // Checked before the cleaning verdict below: no stage can be blamed for
    // losing a body the page never had. What a disabled stage "recovers" here
    // is the title and a link or two, inflated past the threshold by markdown
    // syntax — enough to look like a fix and send the reader after the cleaner.
    console.log(`VERDICT: the page itself carries almost no text — ${fmt(beforePre)} chars before any`)
    console.log('         cleaning ran. Nothing at this URL can be extracted, whatever the')
    console.log('         cleaning stages do. The body is rendered by JS or served inside an')
    console.log('         iframe: find the URL that carries the text directly (iframe src,')
    console.log('         embed URL, or AMP version) and read that instead.')
  } else if (rescued.length > 0) {
    const names = rescued.map(r => `"${r.label}"`).join(', ')
    console.log(`VERDICT: the cleaning pipeline is deleting the body — ${names} recovers it.`)
    console.log('         Look at phase 5 above to see where the character count drops.')
  } else if (production > 0) {
    console.log('VERDICT: extraction yields real but short text, under MIN_EXTRACTED_LENGTH')
    console.log(`         (${MIN_EXTRACTED_LENGTH}). The page itself is short — most likely a paywall teaser.`)
  } else {
    console.log('VERDICT: the page carries no extractable body text at all, and no cleaning')
    console.log('         stage is at fault. The body is paywalled, JS-rendered, or the')
    console.log('         server served a different page to this User-Agent.')
  }
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
