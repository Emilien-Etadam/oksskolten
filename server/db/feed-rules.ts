import { getDb, runNamed } from './connection.js'

export type RuleField = 'title' | 'url' | 'content' | 'any'
export type RuleAction = 'mark_read' | 'hide' | 'bookmark' | 'like' | 'score'

export const RULE_FIELDS: RuleField[] = ['title', 'url', 'content', 'any']
export const RULE_ACTIONS: RuleAction[] = ['mark_read', 'hide', 'bookmark', 'like', 'score']

export interface FeedRule {
  id: number
  /** null applies to every feed */
  feed_id: number | null
  field: RuleField
  pattern: string
  action: RuleAction
  /** Score delta for the `score` action */
  value: number | null
  enabled: number
  match_count: number
  last_matched_at: string | null
  created_at: string
}

export interface FeedRuleWithFeed extends FeedRule {
  feed_name: string | null
}

export function getFeedRules(): FeedRuleWithFeed[] {
  return getDb().prepare(`
    SELECT r.*, f.name AS feed_name
    FROM feed_rules r
    LEFT JOIN feeds f ON f.id = r.feed_id
    ORDER BY r.id ASC
  `).all() as FeedRuleWithFeed[]
}

export function getFeedRuleById(id: number): FeedRuleWithFeed | undefined {
  return getDb().prepare(`
    SELECT r.*, f.name AS feed_name FROM feed_rules r LEFT JOIN feeds f ON f.id = r.feed_id WHERE r.id = ?
  `).get(id) as FeedRuleWithFeed | undefined
}

/** Enabled rules that apply to a feed: its own plus the global ones. */
export function getActiveRulesForFeed(feedId: number): FeedRule[] {
  return getDb().prepare(`
    SELECT * FROM feed_rules WHERE enabled = 1 AND (feed_id IS NULL OR feed_id = ?) ORDER BY id ASC
  `).all(feedId) as FeedRule[]
}

export function createFeedRule(data: {
  feed_id: number | null
  field: RuleField
  pattern: string
  action: RuleAction
  value?: number | null
  enabled?: boolean
}): FeedRuleWithFeed {
  const info = runNamed(`
    INSERT INTO feed_rules (feed_id, field, pattern, action, value, enabled)
    VALUES (@feed_id, @field, @pattern, @action, @value, @enabled)
  `, {
    feed_id: data.feed_id,
    field: data.field,
    pattern: data.pattern,
    action: data.action,
    value: data.value ?? null,
    enabled: data.enabled === false ? 0 : 1,
  })
  return getFeedRuleById(info.lastInsertRowid as number)!
}

export function updateFeedRule(
  id: number,
  data: Partial<{ feed_id: number | null; field: RuleField; pattern: string; action: RuleAction; value: number | null; enabled: boolean }>,
): FeedRuleWithFeed | undefined {
  const existing = getFeedRuleById(id)
  if (!existing) return undefined
  const fields: string[] = []
  const params: Record<string, unknown> = { id }
  if (data.feed_id !== undefined) { fields.push('feed_id = @feed_id'); params.feed_id = data.feed_id }
  if (data.field !== undefined) { fields.push('field = @field'); params.field = data.field }
  if (data.pattern !== undefined) { fields.push('pattern = @pattern'); params.pattern = data.pattern }
  if (data.action !== undefined) { fields.push('action = @action'); params.action = data.action }
  if (data.value !== undefined) { fields.push('value = @value'); params.value = data.value }
  if (data.enabled !== undefined) { fields.push('enabled = @enabled'); params.enabled = data.enabled ? 1 : 0 }
  if (fields.length === 0) return existing
  runNamed(`UPDATE feed_rules SET ${fields.join(', ')} WHERE id = @id`, params)
  return getFeedRuleById(id)
}

export function deleteFeedRule(id: number): boolean {
  return getDb().prepare('DELETE FROM feed_rules WHERE id = ?').run(id).changes > 0
}

export function recordRuleMatch(id: number, count = 1): void {
  getDb().prepare(
    "UPDATE feed_rules SET match_count = match_count + ?, last_matched_at = datetime('now') WHERE id = ?",
  ).run(count, id)
}

/** Recent articles of a rule's scope, newest first, for previews and backfills. */
export function getRecentArticlesForRule(
  feedId: number | null,
  limit: number,
): Array<{ id: number; feed_id: number; title: string; url: string; full_text: string | null }> {
  const where = feedId == null ? '' : 'AND a.feed_id = @feedId'
  return getDb().prepare(`
    SELECT a.id, a.feed_id, a.title, a.url, a.full_text
    FROM active_articles a
    WHERE a.filtered_at IS NULL ${where.replace('@feedId', '?')}
    ORDER BY a.published_at DESC, a.id DESC
    LIMIT ?
  `).all(...(feedId == null ? [limit] : [feedId, limit])) as Array<{ id: number; feed_id: number; title: string; url: string; full_text: string | null }>
}
