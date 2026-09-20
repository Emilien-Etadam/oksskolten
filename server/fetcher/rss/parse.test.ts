import { describe, it, expect, vi, beforeEach } from 'vitest'
import { parseRssXml } from './parse.js'

// Controllable feedsmith mock: flipping the flag exercises the
// fast-xml-parser fallback, which extracts the guid on its own.
let feedsmithShouldFail = false
vi.mock('feedsmith', async (importOriginal) => {
  const real = await importOriginal<typeof import('feedsmith')>()
  return {
    ...real,
    parseFeed: (...args: Parameters<typeof real.parseFeed>) => {
      if (feedsmithShouldFail) throw new Error('feedsmith parse error')
      return real.parseFeed(...args)
    },
  }
})

// Two entries behind one link, told apart by <guid> only — the shape the
// SOLIDWORKS Tech Alerts feed publishes.
const RSS_SHARED_LINK = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>SOLIDWORKS Tech Alerts</title>
    <item>
      <title>SOLIDWORKS 2026 SP4.1 is available for download</title>
      <link>https://www.solidworks.com/sw/support/subscription/downloads.html</link>
      <guid isPermaLink="false">EF50AC02AE161222F10205FE9675AB7D</guid>
      <pubDate>Mon, 14 Sep 2026 13:30:28 GMT</pubDate>
    </item>
    <item>
      <title>SOLIDWORKS 2027 PR1 is available for download</title>
      <link>https://www.solidworks.com/sw/support/subscription/downloads.html</link>
      <guid isPermaLink="false">574784BCECC9994BA07CB709ECF6643A</guid>
      <pubDate>Mon, 10 Aug 2026 11:55:53 GMT</pubDate>
    </item>
  </channel>
</rss>`

const ATOM = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Atom Feed</title>
  <entry>
    <title>Entry</title>
    <id>tag:example.com,2026:entry-1</id>
    <link rel="alternate" href="https://example.com/entry-1"/>
    <updated>2026-09-01T00:00:00Z</updated>
  </entry>
</feed>`

const RDF = `<?xml version="1.0" encoding="UTF-8"?>
<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns="http://purl.org/rss/1.0/">
  <item rdf:about="https://example.com/rdf-1">
    <title>RDF Entry</title>
    <link>https://example.com/rdf-1</link>
  </item>
</rdf:RDF>`

const RSS_NO_GUID = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Plain</title>
    <item>
      <title>No identifier here</title>
      <link>https://example.com/plain</link>
    </item>
  </channel>
</rss>`

describe.each([
  ['feedsmith', false],
  ['fast-xml-parser fallback', true],
])('parseRssXml guid extraction (%s)', (_name, failFeedsmith) => {
  beforeEach(() => { feedsmithShouldFail = failFeedsmith })

  it('reads <guid> even when it carries attributes', async () => {
    const items = await parseRssXml(RSS_SHARED_LINK)
    expect(items.map(i => i.guid)).toEqual([
      'EF50AC02AE161222F10205FE9675AB7D',
      '574784BCECC9994BA07CB709ECF6643A',
    ])
    // Same link on both: without the guid they are indistinguishable.
    expect(new Set(items.map(i => i.url)).size).toBe(1)
  })

  it('reads the Atom <id>', async () => {
    const items = await parseRssXml(ATOM)
    expect(items[0].guid).toBe('tag:example.com,2026:entry-1')
    expect(items[0].url).toBe('https://example.com/entry-1')
  })

  it('reads rdf:about on RSS 1.0 items', async () => {
    const items = await parseRssXml(RDF)
    expect(items[0].guid).toBe('https://example.com/rdf-1')
  })

  it('leaves guid undefined when the feed has none', async () => {
    const items = await parseRssXml(RSS_NO_GUID)
    expect(items[0].guid).toBeUndefined()
    expect(items[0].url).toBe('https://example.com/plain')
  })
})
