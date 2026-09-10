/**
 * Refresh bus for the paginated article list.
 *
 * The list is a `useSWRInfinite` hook, and a global `mutate(key => …)` on its
 * cache keys is not enough to reload it: SWR only refetches pages the infinite
 * fetcher considers stale, and outside collection views `revalidateFirstPage`
 * is off, so every already-cached page is kept. The toast announced new
 * articles while the list stayed as it was until the page was reloaded.
 *
 * Only the `mutate` returned by the hook forces every loaded page to refetch,
 * so the list subscribes it here and anything that brings in new articles
 * (manual refresh, pull-to-refresh, sidebar fetch, the auto-refresh poll)
 * emits on the bus.
 */

type Listener = () => void

const listeners = new Set<Listener>()

/** Subscribe a list revalidator. Returns the unsubscribe function. */
export function subscribeArticleListRefresh(listener: Listener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Ask every mounted article list to refetch the pages it has loaded. */
export function refreshArticleLists(): void {
  for (const listener of [...listeners]) listener()
}
