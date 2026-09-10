import { discoverRssUrl } from './discovery.js'
import { queryRssBridge, inferCssSelectorBridge } from './rss-bridge.js'
import { resolveSocialSearchFeed } from './sources/social-search.js'
import { resolveGithubStarsFeed } from './sources/github-releases.js'

export type ResolveStage = 'github-stars' | 'social' | 'rss-discovery' | 'rss-bridge' | 'css-selector'

export interface ResolveEvent {
  stage: ResolveStage
  status: 'start' | 'done' | 'skipped'
  found?: boolean
}

export interface ResolvedSource {
  rssUrl: string | null
  rssBridgeUrl: string | null
  /** Title the resolver learned, if any (GitHub stars, discovery) */
  title: string | null
  /** Set when discovery ran and the page was fetched via FlareSolverr */
  usedFlareSolverr: boolean
}

export async function resolveFeedSource(
  url: string,
  opts: {
    /** Skip the GitHub-stars and social resolvers (create-feed with a discovered URL or forced selector) */
    skipResolvers?: boolean
    /**
     * Create-only: user chose "this page only". Skip discovery and RSS-Bridge
     * and go straight to CSS-selector inference.
     */
    forcePageSelector?: boolean
    /** Extra options today's create-feed passes to discoverRssUrl */
    discover?: Parameters<typeof discoverRssUrl>[1]
    onEvent?: (event: ResolveEvent) => void
  } = {},
): Promise<ResolvedSource> {
  const emit = (event: ResolveEvent): void => {
    opts.onEvent?.(event)
  }

  const skip = (...stages: ResolveStage[]): void => {
    for (const stage of stages) emit({ stage, status: 'skipped' })
  }

  const empty: ResolvedSource = { rssUrl: null, rssBridgeUrl: null, title: null, usedFlareSolverr: false }

  // GitHub stars pages, Bluesky searches and Mastodon hashtag timelines
  // resolve to a feed without the discovery/bridge pipeline.
  if (opts.skipResolvers || opts.forcePageSelector) {
    skip('github-stars', 'social')
  } else {
    emit({ stage: 'github-stars', status: 'start' })
    const githubStarsFeed = resolveGithubStarsFeed(url)
    emit({ stage: 'github-stars', status: 'done', found: !!githubStarsFeed })
    if (githubStarsFeed) {
      // Stars page: the feed is the account's star list, read via GraphQL
      skip('social', 'rss-discovery', 'rss-bridge', 'css-selector')
      return { ...empty, rssUrl: githubStarsFeed.feedUrl, title: githubStarsFeed.title }
    }

    emit({ stage: 'social', status: 'start' })
    const socialFeedUrl = await resolveSocialSearchFeed(url)
    emit({ stage: 'social', status: 'done', found: !!socialFeedUrl })
    if (socialFeedUrl) {
      // Social search/hashtag URL: the feed is known without discovery
      skip('rss-discovery', 'rss-bridge', 'css-selector')
      return { ...empty, rssUrl: socialFeedUrl }
    }
  }

  if (opts.forcePageSelector) {
    skip('rss-discovery', 'rss-bridge')
    emit({ stage: 'css-selector', status: 'start' })
    const rssBridgeUrl = await inferCssSelectorBridge(url)
    emit({ stage: 'css-selector', status: 'done', found: !!rssBridgeUrl })
    return { ...empty, rssBridgeUrl }
  }

  // Phase 1: normal discovery flow
  emit({ stage: 'rss-discovery', status: 'start' })
  let rssUrl: string | null = null
  let title: string | null = null
  let usedFlareSolverr = false
  try {
    const result = await discoverRssUrl(url, opts.discover)
    rssUrl = result.rssUrl
    title = result.title
    usedFlareSolverr = result.usedFlareSolverr
    emit({ stage: 'rss-discovery', status: 'done', found: !!rssUrl })
  } catch {
    emit({ stage: 'rss-discovery', status: 'done', found: false })
  }

  if (rssUrl) {
    return { rssUrl, rssBridgeUrl: null, title, usedFlareSolverr }
  }

  // Step 2: RSS Bridge fallback
  emit({ stage: 'rss-bridge', status: 'start' })
  const rssBridgeUrl = await queryRssBridge(url)
  emit({ stage: 'rss-bridge', status: 'done', found: !!rssBridgeUrl })

  if (rssBridgeUrl) {
    skip('css-selector')
    return { rssUrl: null, rssBridgeUrl, title, usedFlareSolverr }
  }

  // Step 3: CssSelectorBridge via LLM
  emit({ stage: 'css-selector', status: 'start' })
  const cssBridgeUrl = await inferCssSelectorBridge(url)
  emit({ stage: 'css-selector', status: 'done', found: !!cssBridgeUrl })
  return { rssUrl: null, rssBridgeUrl: cssBridgeUrl, title, usedFlareSolverr }
}
