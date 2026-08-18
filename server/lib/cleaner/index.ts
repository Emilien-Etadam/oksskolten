import { buildPipelineConfig, TEST_ATTRIBUTES, ALLOWED_EMPTY_ELEMENTS, type CleanerConfig } from './selectors.js'
import { removeBySelectors } from './selector-remover.js'
import { measureTextLength, scoreAndRemoveNonContent } from './content-scorer.js'
import { normalizeHtml } from './html-normalizer.js'
import { logger } from '../../logger.js'

const log = logger.child('cleaner')

/**
 * Minimum text a document must still hold once post-clean is done. Mirrors
 * MIN_EXTRACTED_LENGTH in server/fetcher/content.ts, duplicated rather than
 * imported: that module builds the Piscina pool that loads the worker this
 * code runs inside, so importing it here would close the cycle.
 */
const MIN_SURVIVING_TEXT = 200

/**
 * Lightweight pre-clean before Readability.
 * Removes only elements that are never article content (script, style, hidden, etc.).
 * Fail-open: exceptions are caught and the original document is used as-is.
 */
export function preClean(doc: Document, config?: CleanerConfig): void {
  try {
    const { preCleanSelectors } = buildPipelineConfig(config)
    if (preCleanSelectors.length === 0) return

    removeBySelectors(doc, { exactSelectors: preCleanSelectors })
  } catch (err) {
    log.warn('preClean failed, continuing with original HTML:', err)
  }
}

/**
 * Post-clean after Readability extraction.
 * Removes remaining noise from extracted article content using:
 *   1. Exact CSS selector matching (ads, nav, comments, sidebar, etc.)
 *   2. Partial attribute pattern matching (~400 patterns against class/id/data-*)
 *
 * Fail-open: exceptions are caught and the Readability output is used as-is,
 * and a pass that strips the document down to nothing is rolled back (see the
 * guard at the end).
 */
export function postClean(doc: Document, config?: CleanerConfig): void {
  try {
    const pipeline = buildPipelineConfig(config)
    const originalHtml = doc.body?.innerHTML ?? ''
    const originalLen = measureTextLength(doc.body?.textContent ?? '')

    // Step 1: Selector-based removal (exact + partial patterns)
    const hasExact = pipeline.postCleanSelectors.length > 0
    const hasPartial = pipeline.partialSelectors.length > 0

    if (hasExact || hasPartial) {
      removeBySelectors(doc, {
        exactSelectors: pipeline.postCleanSelectors,
        partialSelectors: hasPartial ? pipeline.partialSelectors : undefined,
        testAttributes: TEST_ATTRIBUTES,
      })
    }

    // Step 2: Scoring-based removal (CJK-aware character-count thresholds)
    if (pipeline.scoringEnabled) {
      scoreAndRemoveNonContent(doc, {
        thresholdOffset: pipeline.scoringThresholdOffset,
      })
    }

    // Step 3: HTML normalization (attribute cleanup, empty element removal, div flattening)
    if (pipeline.normalizationEnabled) {
      const body = doc.body
      if (body) {
        normalizeHtml(doc, body, {
          allowedAttributes: pipeline.allowedAttributes,
          allowedEmptyElements: ALLOWED_EMPTY_ELEMENTS,
        })
      }
    }

    // Guard: the ~400 partial patterns are substrings tested against class /
    // id / data-*, so a site that namespaces its markup with one of them loses
    // its whole article. next.ink wraps every post in id="next-single-post",
    // which the 'next-' pattern for next-article links matched, storing an
    // empty body with no error to show for it. Whatever noise survives is
    // worth more than nothing, so undo a pass that leaves too little behind.
    const survivingLen = measureTextLength(doc.body?.textContent ?? '')
    if (doc.body && originalLen >= MIN_SURVIVING_TEXT && survivingLen < MIN_SURVIVING_TEXT) {
      log.warn(
        `post-clean removed nearly all content (${originalLen} -> ${survivingLen} chars), ` +
        'restoring Readability output',
      )
      doc.body.innerHTML = originalHtml
    }
  } catch (err) {
    log.warn('postClean failed, continuing with Readability output:', err)
  }
}
