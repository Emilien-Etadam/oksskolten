import { describe, it, expect } from 'vitest'
import { versionArchivedMediaUrls, ARCHIVED_MEDIA_VERSION } from './archived-media'

const V = `?v=${ARCHIVED_MEDIA_VERSION}`

describe('versionArchivedMediaUrls', () => {
  it('stamps archived images in Markdown, linked or not', () => {
    const md = '[![](/api/articles/images/41428_9afd8cb1cc34.png)](https://blogger.googleusercontent.com/img/b/x/s724/a.png)\n\n![](/api/articles/images/41428_0123456789ab.jpg)'
    expect(versionArchivedMediaUrls(md)).toBe(
      `[![](/api/articles/images/41428_9afd8cb1cc34.png${V})](https://blogger.googleusercontent.com/img/b/x/s724/a.png)\n\n![](/api/articles/images/41428_0123456789ab.jpg${V})`,
    )
  })

  it('stamps archived videos in the player markup', () => {
    const html = '<video controls preload="none" src="/api/articles/videos/7_abc.mp4" poster="https://i.ytimg.com/vi/x/hq.jpg"></video>'
    expect(versionArchivedMediaUrls(html)).toBe(
      `<video controls preload="none" src="/api/articles/videos/7_abc.mp4${V}" poster="https://i.ytimg.com/vi/x/hq.jpg"></video>`,
    )
  })

  it('leaves remote media and URLs that already carry a query alone', () => {
    const md = '![](https://example.com/api/x.png) ![](/api/articles/images/1_abc.png?v=9)'
    expect(versionArchivedMediaUrls(md)).toBe(md)
  })

  it('returns text without archived media unchanged', () => {
    expect(versionArchivedMediaUrls('Just text')).toBe('Just text')
  })
})
