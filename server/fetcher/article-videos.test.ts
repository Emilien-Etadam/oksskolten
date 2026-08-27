import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { setupTestDb } from '../__tests__/helpers/testDb.js'
import { createFeed, insertArticle, getArticleById, upsertSetting } from '../db.js'

const { mockExecFile } = vi.hoisted(() => ({
  mockExecFile: vi.fn(),
}))

// promisify() wraps this with the callback convention, so the mock answers by
// calling back rather than returning a promise.
vi.mock('node:child_process', () => ({
  execFile: (bin: string, args: string[], opts: unknown, cb: (err: Error | null, stdout: string, stderr: string) => void) =>
    mockExecFile(bin, args, opts, cb),
}))

import {
  findArchivableVideos,
  videoPlayerMarkup,
  archiveArticleVideos,
  deleteArticleVideos,
  isVideoArchivingEnabled,
} from './article-videos.js'

const WATCH = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
const POSTER = 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg'
const CARD = `[![Parasolid history](${POSTER})](${WATCH})`

describe('findArchivableVideos', () => {
  it('finds the card the extraction pipeline writes', () => {
    const found = findArchivableVideos(`Some prose.\n\n${CARD}\n\nMore prose.`)

    expect(found).toHaveLength(1)
    expect(found[0]).toMatchObject({
      markdown: CARD,
      watchUrl: WATCH,
      poster: POSTER,
      label: 'Parasolid history',
    })
  })

  it('finds a plain link to a video, which is what a posterless provider leaves', () => {
    const found = findArchivableVideos('Watch [Vimeo](https://vimeo.com/76979871) for the rest.')

    expect(found).toHaveLength(1)
    expect(found[0]).toMatchObject({ watchUrl: 'https://vimeo.com/76979871', poster: null })
  })

  it('lists a video once however many times the article links it', () => {
    expect(findArchivableVideos(`${CARD}\n\n[again](${WATCH})`)).toHaveLength(1)
  })

  it('ignores links that are not videos', () => {
    const text = '[the docs](https://example.com/docs) and ![a picture](https://example.com/p.png)'

    expect(findArchivableVideos(text)).toEqual([])
  })
})

describe('videoPlayerMarkup', () => {
  it('carries the poster and label over to the player', () => {
    const [candidate] = findArchivableVideos(CARD)

    expect(videoPlayerMarkup(candidate, '/api/articles/videos/1_abc.mp4')).toBe(
      '<video controls preload="none" src="/api/articles/videos/1_abc.mp4" ' +
      `poster="${POSTER}" title="Parasolid history"></video>`,
    )
  })

  it('does not let a label break out of the attribute it sits in', () => {
    const [candidate] = findArchivableVideos(`[![He said "hi" <b>](${POSTER})](${WATCH})`)

    const markup = videoPlayerMarkup(candidate, '/v.mp4')
    expect(markup).toContain('title="He said &quot;hi&quot; &lt;b&gt;"')
  })
})

describe('archiveArticleVideos', () => {
  let tmpDir: string
  let articleId: number

  beforeEach(() => {
    setupTestDb()
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reader-test-videos-'))
    upsertSetting('videos.storage_path', tmpDir)
    const feed = createFeed({ name: 'Blog', url: 'https://blog.example.com' })
    articleId = insertArticle({
      feed_id: feed.id,
      title: 'Parasolid',
      url: 'https://blog.example.com/parasolid',
      published_at: '2026-01-01T00:00:00Z',
      full_text: `Some prose.\n\n${CARD}\n\nMore prose.`,
    })
    mockExecFile.mockReset()
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  /** Stand in for yt-dlp: write the file it was asked to produce. */
  function downloaderWrites() {
    mockExecFile.mockImplementation((_bin, args: string[], _opts, cb) => {
      const target = args[args.indexOf('-o') + 1]
      fs.writeFileSync(target, 'video bytes')
      cb(null, '', '')
    })
  }

  it('downloads the video and points the article at the local copy', async () => {
    downloaderWrites()

    const result = await archiveArticleVideos(articleId, getArticleById(articleId)!.full_text!)

    expect(result.downloaded).toBe(1)
    expect(result.errors).toBe(0)
    const stored = getArticleById(articleId)!
    expect(stored.full_text).toContain('<video controls preload="none" src="/api/articles/videos/')
    expect(stored.full_text).not.toContain(WATCH)
    expect(stored.videos_archived_at).toBeTruthy()
    // The prose either side is untouched.
    expect(stored.full_text).toContain('Some prose.')
    expect(stored.full_text).toContain('More prose.')
  })

  it('caps the download by height and by size', async () => {
    upsertSetting('videos.max_height', '480')
    upsertSetting('videos.max_size_mb', '250')
    downloaderWrites()

    await archiveArticleVideos(articleId, getArticleById(articleId)!.full_text!)

    const args = mockExecFile.mock.calls[0][1] as string[]
    expect(args.join(' ')).toContain('height<=?480')
    expect(args[args.indexOf('--max-filesize') + 1]).toBe('250m')
  })

  it('leaves the article alone when the download fails', async () => {
    mockExecFile.mockImplementation((_bin, _args, _opts, cb) => cb(new Error('yt-dlp: ENOENT'), '', ''))
    const before = getArticleById(articleId)!.full_text

    const result = await archiveArticleVideos(articleId, before!)

    expect(result.downloaded).toBe(0)
    expect(result.errors).toBe(1)
    expect(getArticleById(articleId)!.full_text).toBe(before)
    // Not marked as archived: the reader has to be able to press the button
    // again once whatever broke the download is fixed.
    expect(getArticleById(articleId)!.videos_archived_at).toBeNull()
  })

  it('counts a silent no-op as an error rather than rewriting to a missing file', async () => {
    // yt-dlp exits 0 without writing when the video is over --max-filesize.
    mockExecFile.mockImplementation((_bin, _args, _opts, cb) => cb(null, '', ''))
    const before = getArticleById(articleId)!.full_text

    const result = await archiveArticleVideos(articleId, before!)

    expect(result).toMatchObject({ downloaded: 0, errors: 1 })
    expect(getArticleById(articleId)!.full_text).toBe(before)
    expect(getArticleById(articleId)!.videos_archived_at).toBeNull()
  })

  it('deletes an article\'s archived videos and nothing else', async () => {
    downloaderWrites()
    await archiveArticleVideos(articleId, getArticleById(articleId)!.full_text!)
    fs.writeFileSync(path.join(tmpDir, '999_other.mp4'), 'someone else')

    expect(deleteArticleVideos(articleId)).toBe(1)
    expect(fs.readdirSync(tmpDir)).toEqual(['999_other.mp4'])
  })
})

describe('isVideoArchivingEnabled', () => {
  beforeEach(() => { setupTestDb() })

  it('accepts what the preferences UI writes and what image archiving uses', () => {
    for (const value of ['on', '1', 'true']) {
      upsertSetting('videos.enabled', value)
      expect(isVideoArchivingEnabled(), value).toBe(true)
    }
    for (const value of ['off', '0', '']) {
      upsertSetting('videos.enabled', value)
      expect(isVideoArchivingEnabled(), value).toBe(false)
    }
  })
})
