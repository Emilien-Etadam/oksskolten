import {
  getActiveRulesForFeed,
  recordRuleMatch,
  getRecentArticlesForRule,
  type FeedRule,
  type RuleField,
  type RuleAction,
} from './rules-db.js'
import { markArticleSeen, markArticleBookmarked, markArticleLiked, updateArticleContent, addRuleBoost } from '../db/articles.js'
import { logger } from '../logger.js'

const log = logger.child('rules')

/** Longest accepted pattern; long alternations are fine, pathological ones are not our concern here */
export const MAX_PATTERN_LENGTH = 300

export interface RuleInput {
  title: string
  url: string
  content: string | null
}

const regexCache = new Map<string, RegExp | null>()

/** Compile once per pattern; an invalid pattern never matches. */
export function compileRule(pattern: string): RegExp | null {
  const cached = regexCache.get(pattern)
  if (cached !== undefined) return cached
  let re: RegExp | null
  try {
    re = pattern.length <= MAX_PATTERN_LENGTH ? new RegExp(pattern, 'iu') : null
  } catch {
    re = null
  }
  if (regexCache.size > 500) regexCache.clear()
  regexCache.set(pattern, re)
  return re
}

export function isValidPattern(pattern: string): boolean {
  return compileRule(pattern) !== null
}

export function ruleMatches(rule: { field: RuleField; pattern: string }, input: RuleInput): boolean {
  const re = compileRule(rule.pattern)
  if (!re) return false
  switch (rule.field) {
    case 'title': return re.test(input.title)
    case 'url': return re.test(input.url)
    case 'content': return !!input.content && re.test(input.content)
    case 'any': return re.test(input.title) || re.test(input.url) || (!!input.content && re.test(input.content))
  }
}

function performAction(articleId: number, action: RuleAction, value: number | null): void {
  switch (action) {
    case 'mark_read':
      markArticleSeen(articleId, true)
      break
    case 'hide':
      updateArticleContent(articleId, { filtered_at: new Date().toISOString() })
      break
    case 'bookmark':
      markArticleBookmarked(articleId, true)
      break
    case 'like':
      markArticleLiked(articleId, true)
      break
    case 'score':
      if (value) addRuleBoost(articleId, value)
      break
  }
}

/**
 * Apply every enabled rule of the feed (and the global ones) to a freshly
 * inserted article. Returns the rules that matched. Actions are idempotent,
 * so re-running over an article is safe.
 */
export function applyRulesToArticle(articleId: number, feedId: number, input: RuleInput, rules?: FeedRule[]): FeedRule[] {
  const candidates = rules ?? getActiveRulesForFeed(feedId)
  const matched: FeedRule[] = []
  for (const rule of candidates) {
    if (!ruleMatches(rule, input)) continue
    try {
      performAction(articleId, rule.action, rule.value)
      recordRuleMatch(rule.id)
      matched.push(rule)
    } catch (err) {
      log.warn(`rule ${rule.id} (${rule.action}) failed on article ${articleId}: ${err instanceof Error ? err.message : err}`)
    }
  }
  if (matched.length > 0) {
    log.info(`article ${articleId}: ${matched.map(r => `#${r.id} ${r.action}`).join(', ')}`)
  }
  return matched
}

/** Backfill one rule over the latest articles of its scope. */
export function applyRuleToExisting(rule: FeedRule, limit = 500): { matched: number } {
  let matched = 0
  for (const article of getRecentArticlesForRule(rule.feed_id, limit)) {
    if (ruleMatches(rule, { title: article.title, url: article.url, content: article.full_text })) {
      performAction(article.id, rule.action, rule.value)
      matched++
    }
  }
  if (matched > 0) recordRuleMatch(rule.id, matched)
  return { matched }
}

/** Dry run of a pattern over recent articles: how many match, with sample titles. */
export function previewRule(
  rule: { feed_id: number | null; field: RuleField; pattern: string },
  limit = 200,
): { scanned: number; matched: number; samples: Array<{ id: number; title: string; url: string }> } {
  const articles = getRecentArticlesForRule(rule.feed_id, limit)
  const samples: Array<{ id: number; title: string; url: string }> = []
  let matched = 0
  for (const article of articles) {
    if (!ruleMatches(rule, { title: article.title, url: article.url, content: article.full_text })) continue
    matched++
    if (samples.length < 10) samples.push({ id: article.id, title: article.title, url: article.url })
  }
  return { scanned: articles.length, matched, samples }
}
