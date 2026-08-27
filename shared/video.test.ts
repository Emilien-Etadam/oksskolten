import { describe, it, expect } from 'vitest'
import { parseVideoUrl } from './video.js'

describe('parseVideoUrl', () => {
  it('recognises the shapes a YouTube embed takes', () => {
    const urls = [
      'https://www.youtube.com/embed/dQw4w9WgXcQ',
      'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?rel=0',
      'https://youtube.com/embed/dQw4w9WgXcQ',
      'https://youtu.be/dQw4w9WgXcQ',
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42',
      '//www.youtube.com/embed/dQw4w9WgXcQ',
    ]

    for (const url of urls) {
      expect(parseVideoUrl(url), url).toMatchObject({
        provider: 'youtube',
        id: 'dQw4w9WgXcQ',
        watchUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        poster: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
      })
    }
  })

  it('recognises Vimeo, which serves no predictable poster', () => {
    expect(parseVideoUrl('https://player.vimeo.com/video/76979871')).toMatchObject({
      provider: 'vimeo',
      id: '76979871',
      watchUrl: 'https://vimeo.com/76979871',
      poster: null,
    })
  })

  it('ignores anything that is not a video', () => {
    const urls = [
      'https://www.youtube.com/',
      'https://www.youtube.com/results?search_query=cad',
      'https://blogs.sw.siemens.com/plm-components/parasolid-in-the-history-of-cad/',
      'https://vimeo.com/channels/staffpicks',
      'javascript:void(0)',
      '',
      null,
      undefined,
    ]

    for (const url of urls) {
      expect(parseVideoUrl(url), String(url)).toBeNull()
    }
  })
})
