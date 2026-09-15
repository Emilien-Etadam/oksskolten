import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const mockGetSetting = vi.fn()

vi.mock('../../db.js', () => ({
  getSetting: (key: string) => mockGetSetting(key),
}))

import {
  parseDiscordChannelUrl,
  isDiscordChannelUrl,
  isDiscordMessageUrl,
  discordChannelFeedUrl,
  discordMessageUrl,
  getDiscordBotToken,
  resolveDiscordChannelFeed,
  fetchDiscordChannel,
} from './discord-channel.js'
import { RateLimitError } from '../../fetcher/rss/types.js'

const GUILD = '123456789012345678'
const CHANNEL = '234567890123456789'
const MESSAGE = '345678901234567890'
const CHANNEL_URL = `https://discord.com/channels/${GUILD}/${CHANNEL}`

const settingsStore = new Map<string, string>()
const mockFetch = vi.fn()

function message(overrides: Record<string, unknown> = {}) {
  return {
    id: MESSAGE,
    type: 0,
    content: 'Release 1.4 is out.\nGrab it from the downloads page.',
    timestamp: '2026-09-15T10:00:00.000000+00:00',
    author: { username: 'maintainer', global_name: 'The Maintainer' },
    attachments: [],
    embeds: [],
    ...overrides,
  }
}

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    headers: new Headers(headers),
  }
}

beforeEach(() => {
  settingsStore.clear()
  settingsStore.set('discord.bot_token', 'bot-token')
  mockGetSetting.mockReset().mockImplementation((key: string) => settingsStore.get(key) ?? '')
  mockFetch.mockReset()
  vi.stubGlobal('fetch', mockFetch)
  delete process.env.DISCORD_BOT_TOKEN
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('parseDiscordChannelUrl', () => {
  it('parses a channel URL', () => {
    expect(parseDiscordChannelUrl(CHANNEL_URL)).toEqual({ guildId: GUILD, channelId: CHANNEL })
  })

  it('accepts a message link as a way to name its channel', () => {
    expect(parseDiscordChannelUrl(`${CHANNEL_URL}/${MESSAGE}`)).toEqual({ guildId: GUILD, channelId: CHANNEL })
  })

  it('accepts the app subdomains and the legacy host', () => {
    for (const host of ['ptb.discord.com', 'canary.discord.com', 'discordapp.com']) {
      expect(parseDiscordChannelUrl(`https://${host}/channels/${GUILD}/${CHANNEL}`)).not.toBeNull()
    }
  })

  it('rejects direct messages, non-channel paths, short ids and other hosts', () => {
    expect(parseDiscordChannelUrl(`https://discord.com/channels/@me/${CHANNEL}`)).toBeNull()
    expect(parseDiscordChannelUrl(`https://discord.com/invite/${GUILD}`)).toBeNull()
    expect(parseDiscordChannelUrl('https://discord.com/channels/12/34')).toBeNull()
    expect(parseDiscordChannelUrl(`https://discord.gg/${GUILD}`)).toBeNull()
    expect(parseDiscordChannelUrl('not a url')).toBeNull()
  })

  it('distinguishes a channel URL from a message permalink', () => {
    expect(isDiscordChannelUrl(CHANNEL_URL)).toBe(true)
    expect(isDiscordMessageUrl(CHANNEL_URL)).toBe(false)
    expect(isDiscordMessageUrl(`${CHANNEL_URL}/${MESSAGE}`)).toBe(true)
    expect(isDiscordMessageUrl('https://example.com/a/b/c')).toBe(false)
  })

  it('collapses a message link to its channel', () => {
    const ref = parseDiscordChannelUrl(`${CHANNEL_URL}/${MESSAGE}`)!
    expect(discordChannelFeedUrl(ref)).toBe(CHANNEL_URL)
    expect(discordMessageUrl(ref, MESSAGE)).toBe(`${CHANNEL_URL}/${MESSAGE}`)
  })
})

describe('getDiscordBotToken', () => {
  it('prefers the setting over the environment variable', () => {
    process.env.DISCORD_BOT_TOKEN = 'env-token'
    expect(getDiscordBotToken()).toBe('bot-token')
  })

  it('falls back to the environment variable', () => {
    settingsStore.delete('discord.bot_token')
    process.env.DISCORD_BOT_TOKEN = 'env-token'
    expect(getDiscordBotToken()).toBe('env-token')
  })

  it('reports no token when neither is set', () => {
    settingsStore.delete('discord.bot_token')
    expect(getDiscordBotToken()).toBeNull()
  })
})

describe('resolveDiscordChannelFeed', () => {
  it('names the feed after the channel', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ id: CHANNEL, name: 'announcements' }))

    await expect(resolveDiscordChannelFeed(CHANNEL_URL)).resolves.toEqual({
      feedUrl: CHANNEL_URL,
      title: 'Discord #announcements',
    })
    const [url, init] = mockFetch.mock.calls[0]
    expect(url).toBe(`https://discord.com/api/v10/channels/${CHANNEL}`)
    expect(init.headers.Authorization).toBe('Bot bot-token')
  })

  it('still resolves without a token, so the feed can be created first', async () => {
    settingsStore.delete('discord.bot_token')

    await expect(resolveDiscordChannelFeed(CHANNEL_URL)).resolves.toEqual({
      feedUrl: CHANNEL_URL,
      title: 'Discord',
    })
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('falls back to a generic name when the channel cannot be read', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ message: 'Missing Access' }, 403))

    await expect(resolveDiscordChannelFeed(CHANNEL_URL)).resolves.toEqual({
      feedUrl: CHANNEL_URL,
      title: 'Discord',
    })
  })

  it('returns null for a URL it does not own', async () => {
    await expect(resolveDiscordChannelFeed('https://github.com/trending')).resolves.toBeNull()
  })
})

describe('fetchDiscordChannel', () => {
  it('turns messages into items, body and all', async () => {
    mockFetch.mockResolvedValue(jsonResponse([message()]))

    const items = await fetchDiscordChannel(CHANNEL_URL)

    const [url] = mockFetch.mock.calls[0]
    expect(url).toBe(`https://discord.com/api/v10/channels/${CHANNEL}/messages?limit=50`)
    expect(items).toEqual([{
      title: 'Release 1.4 is out.',
      url: `${CHANNEL_URL}/${MESSAGE}`,
      published_at: expect.stringContaining('2026-09-15'),
      excerpt: 'Release 1.4 is out.\nGrab it from the downloads page.',
    }])
  })

  it('folds embeds and attachments into the body', async () => {
    mockFetch.mockResolvedValue(jsonResponse([message({
      content: '',
      embeds: [{ title: 'Changelog', description: 'Fixes the thing.', url: 'https://example.com/changelog' }],
      attachments: [{ filename: 'notes.pdf', url: 'https://cdn.discordapp.com/notes.pdf' }],
    })]))

    const [item] = await fetchDiscordChannel(CHANNEL_URL)

    expect(item.excerpt).toBe(
      'Changelog\nFixes the thing.\nhttps://example.com/changelog\n\nnotes.pdf: https://cdn.discordapp.com/notes.pdf',
    )
    expect(item.title).toBe('Message from The Maintainer')
  })

  it('truncates a long first line for the title', async () => {
    mockFetch.mockResolvedValue(jsonResponse([message({ content: `${'word '.repeat(40)}end` })]))

    const [item] = await fetchDiscordChannel(CHANNEL_URL)

    expect(item.title.length).toBeLessThanOrEqual(121)
    expect(item.title.endsWith('…')).toBe(true)
  })

  it('skips system messages and messages with nothing to read', async () => {
    mockFetch.mockResolvedValue(jsonResponse([
      message({ id: '1', type: 7 }),
      message({ id: '2', content: '', embeds: [], attachments: [] }),
      message({ id: '3', type: 19, content: 'A reply worth reading' }),
    ]))

    const items = await fetchDiscordChannel(CHANNEL_URL)

    expect(items.map(i => i.title)).toEqual(['A reply worth reading'])
  })

  it('reports a missing token instead of calling the API', async () => {
    settingsStore.delete('discord.bot_token')

    await expect(fetchDiscordChannel(CHANNEL_URL)).rejects.toThrow(/No Discord bot token configured/)
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('explains a permission failure in terms of the fix', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ message: 'Missing Access' }, 403))

    await expect(fetchDiscordChannel(CHANNEL_URL)).rejects.toThrow(/invite it to the server/)
  })

  it('explains a rejected token', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ message: '401: Unauthorized' }, 401))

    await expect(fetchDiscordChannel(CHANNEL_URL)).rejects.toThrow(/rejected the bot token/)
  })

  it('surfaces a rate limit so the feed backs off', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ retry_after: 30 }, 429, { 'retry-after': '30' }))

    await expect(fetchDiscordChannel(CHANNEL_URL)).rejects.toBeInstanceOf(RateLimitError)
  })

  it('refuses a URL that is not a Discord channel', async () => {
    await expect(fetchDiscordChannel('https://github.com/trending')).rejects.toThrow(/Not a Discord channel URL/)
    expect(mockFetch).not.toHaveBeenCalled()
  })
})
