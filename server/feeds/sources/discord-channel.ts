import type { RssItem } from '../../fetcher/rss/types.js'
import { RateLimitError } from '../../fetcher/rss/types.js'
import { normalizeDate } from '../../fetcher/util.js'
import { getSetting } from '../../db.js'
import { logger } from '../../logger.js'

const log = logger.child('discord-channel')

/**
 * Turn a Discord channel into a feed.
 *
 * Discord publishes no RSS and its web app is a login wall, so neither
 * discovery nor scraping reaches a channel. The REST API does, with a bot
 * token: one request per cycle returns the channel's recent messages, and each
 * message becomes an article.
 */

const API_BASE = 'https://discord.com/api/v10'
const REQUEST_TIMEOUT_MS = 15_000

/** Messages per fetch. Discord's maximum is 100; the reader caps per feed anyway. */
const MESSAGES_PER_FETCH = 50

/** Messages have no title, so one is derived from the opening line of the text. */
const TITLE_MAX_CHARS = 120

/**
 * Message types that carry something to read. `0` is a plain message and `19`
 * a reply; every other type is Discord's own chrome — joins, boosts, pins,
 * call notices — which would arrive as empty articles.
 */
const READABLE_MESSAGE_TYPES = new Set([0, 19])

/** Hosts Discord itself serves the web app from, all sharing one URL shape. */
const DISCORD_HOSTS = new Set(['discord.com', 'ptb.discord.com', 'canary.discord.com', 'discordapp.com'])

export interface DiscordChannelRef {
  guildId: string
  channelId: string
}

function isSnowflake(segment: string | undefined): segment is string {
  return typeof segment === 'string' && /^\d{17,20}$/.test(segment)
}

/**
 * Parse a channel URL as copied from the Discord app
 * (`https://discord.com/channels/<guild>/<channel>`), or null when it is not
 * one.
 *
 * A message link (`…/<guild>/<channel>/<message>`) names the same channel and
 * is accepted as a way to reach it. `@me` is a direct message, which a bot
 * cannot read, so it is rejected rather than failing later on every fetch.
 */
export function parseDiscordChannelUrl(url: string): DiscordChannelRef | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  if (!DISCORD_HOSTS.has(parsed.hostname.replace(/^www\./, ''))) return null

  const segments = parsed.pathname.replace(/^\/+|\/+$/g, '').split('/')
  if (segments[0] !== 'channels') return null

  const [, guildId, channelId] = segments
  if (!isSnowflake(guildId) || !isSnowflake(channelId)) return null
  if (segments.length > 4) return null

  return { guildId, channelId }
}

export function isDiscordChannelUrl(url: string): boolean {
  return parseDiscordChannelUrl(url) !== null
}

/**
 * Canonical feed URL for a channel. A message link collapses to the channel it
 * belongs to, so the same channel cannot be subscribed to twice, and the stored
 * URL stays a link that opens the channel in Discord.
 */
export function discordChannelFeedUrl(ref: DiscordChannelRef): string {
  return `https://discord.com/channels/${ref.guildId}/${ref.channelId}`
}

/** Permalink of one message, which is what an article points at. */
export function discordMessageUrl(ref: DiscordChannelRef, messageId: string): string {
  return `${discordChannelFeedUrl(ref)}/${messageId}`
}

/** A message permalink, as opposed to the channel URL a feed is stored under. */
export function isDiscordMessageUrl(url: string): boolean {
  if (!isDiscordChannelUrl(url)) return false
  const segments = new URL(url).pathname.replace(/^\/+|\/+$/g, '').split('/')
  return isSnowflake(segments[3])
}

/**
 * Token used for every API call. The `discord.bot_token` DB setting (Settings →
 * Integration) takes precedence over `DISCORD_BOT_TOKEN` so a token entered in
 * the UI takes effect without a container restart; the env var remains for
 * deployments that prefer configuring it outside the app.
 */
export function getDiscordBotToken(): string | null {
  return getSetting('discord.bot_token') || process.env.DISCORD_BOT_TOKEN || null
}

async function discordApi(path: string, token: string): Promise<Response> {
  return fetch(`${API_BASE}${path}`, {
    headers: { Authorization: `Bot ${token}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
}

/**
 * Turn an API failure into the error the feed should carry. Discord answers
 * every permission problem with 403, and the fix — inviting the bot, granting
 * it the channel — is not something the reader can guess from a bare status.
 */
function apiError(status: number, res: Response): Error {
  if (status === 429) return new RateLimitError(status, res.headers.get('retry-after'))
  if (status === 401) {
    return new Error('Discord rejected the bot token — check it in Settings → Integration')
  }
  if (status === 403) {
    return new Error(
      'The bot cannot read this channel — invite it to the server and grant it View Channel and Read Message History',
    )
  }
  if (status === 404) return new Error('Discord channel not found — the bot may not be in this server')
  return new Error(`HTTP ${status}`)
}

export interface DiscordChannelFeed {
  feedUrl: string
  title: string
}

/**
 * Resolve a pasted URL to a channel feed, or null when it is not one.
 *
 * The channel's own name makes the better feed title, so it is read once here,
 * at create time. Without a token, or when the bot cannot see the channel yet,
 * the feed still gets created — the fetch is what surfaces that problem, with
 * an error the user can act on.
 */
export async function resolveDiscordChannelFeed(url: string): Promise<DiscordChannelFeed | null> {
  const ref = parseDiscordChannelUrl(url)
  if (!ref) return null

  const feedUrl = discordChannelFeedUrl(ref)
  const token = getDiscordBotToken()
  if (!token) return { feedUrl, title: 'Discord' }

  try {
    const res = await discordApi(`/channels/${ref.channelId}`, token)
    if (res.ok) {
      const channel = await res.json() as { name?: unknown }
      if (typeof channel.name === 'string' && channel.name) {
        return { feedUrl, title: `Discord #${channel.name}` }
      }
    } else {
      log.warn(`Could not read channel ${ref.channelId} for its name: HTTP ${res.status}`)
    }
  } catch (err) {
    log.warn({ err }, `Could not read channel ${ref.channelId} for its name`)
  }
  return { feedUrl, title: 'Discord' }
}

interface DiscordAttachment {
  filename?: unknown
  url?: unknown
}

interface DiscordEmbed {
  title?: unknown
  description?: unknown
  url?: unknown
}

interface DiscordMessage {
  id?: unknown
  type?: unknown
  content?: unknown
  timestamp?: unknown
  author?: { username?: unknown; global_name?: unknown }
  attachments?: unknown
  embeds?: unknown
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function messageTitle(text: string, author: string): string {
  const firstLine = text.split('\n').map(line => line.trim()).find(Boolean)
  if (!firstLine) return `Message from ${author}`
  if (firstLine.length <= TITLE_MAX_CHARS) return firstLine

  const truncated = firstLine.slice(0, TITLE_MAX_CHARS)
  const lastSpace = truncated.lastIndexOf(' ')
  const cut = lastSpace > TITLE_MAX_CHARS / 2 ? truncated.slice(0, lastSpace) : truncated
  return `${cut.trimEnd()}…`
}

/**
 * Everything the message says, in one block.
 *
 * The permalink is a login wall, so nothing can be extracted from it later:
 * this text is the article body, which is why embeds and attachments are
 * folded in rather than left behind on Discord.
 */
function messageBody(message: DiscordMessage): string {
  const parts: string[] = []
  const content = str(message.content).trim()
  if (content) parts.push(content)

  const embeds = Array.isArray(message.embeds) ? message.embeds as DiscordEmbed[] : []
  for (const embed of embeds) {
    const lines = [str(embed.title).trim(), str(embed.description).trim(), str(embed.url).trim()]
    const embedText = lines.filter(Boolean).join('\n')
    if (embedText) parts.push(embedText)
  }

  const attachments = Array.isArray(message.attachments) ? message.attachments as DiscordAttachment[] : []
  for (const attachment of attachments) {
    const filename = str(attachment.filename).trim()
    const url = str(attachment.url).trim()
    if (url) parts.push(filename ? `${filename}: ${url}` : url)
  }

  return parts.join('\n\n')
}

function toRssItem(message: DiscordMessage, ref: DiscordChannelRef): RssItem | null {
  const id = str(message.id)
  if (!id) return null
  if (typeof message.type === 'number' && !READABLE_MESSAGE_TYPES.has(message.type)) return null

  const body = messageBody(message)
  if (!body) return null

  const author = str(message.author?.global_name) || str(message.author?.username) || 'unknown'

  return {
    title: messageTitle(str(message.content), author),
    url: discordMessageUrl(ref, id),
    published_at: normalizeDate(str(message.timestamp)),
    excerpt: body,
  }
}

/**
 * Fetch a channel's recent messages as feed items.
 *
 * Requires a bot token that is a member of the server: the API rejects
 * anonymous requests, and Discord grants channel access per bot, not per token.
 */
export async function fetchDiscordChannel(feedUrl: string): Promise<RssItem[]> {
  const ref = parseDiscordChannelUrl(feedUrl)
  if (!ref) throw new Error(`Not a Discord channel URL: ${feedUrl}`)

  const token = getDiscordBotToken()
  if (!token) {
    throw new Error('No Discord bot token configured — set one in Settings → Integration, or DISCORD_BOT_TOKEN')
  }

  const res = await discordApi(`/channels/${ref.channelId}/messages?limit=${MESSAGES_PER_FETCH}`, token)
  if (!res.ok) throw apiError(res.status, res)

  const payload: unknown = await res.json()
  const messages = Array.isArray(payload) ? payload as DiscordMessage[] : []
  const items = messages
    .map(message => toRssItem(message, ref))
    .filter((item): item is RssItem => item !== null)

  log.info(`Channel ${ref.channelId}: ${items.length} messages of ${messages.length}`)
  return items
}
