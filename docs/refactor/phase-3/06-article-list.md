# 06 — Split `ArticleList` (761 lines) into hooks

Read `00-context.md` first. Commits 01–05 must be done. The file is now
`src/features/reading/components/article-list.tsx`.

## Goal

`ArticleList` is one 620-line component body: data fetching, crosspost
grouping, keyboard-navigation publishing, infinite scroll, auto-mark-read
batching, touch handling, day grouping and rendering, all in one closure with
about 25 `useRef` / `useState` / `useEffect`. Extract the self-contained
concerns into hooks in the same directory, each with a test. **No behaviour
change**: the JSX and the props of the rendered children stay identical.

Read the whole file first. The line numbers below are those of the file
before any edit in this commit (they did not change in 02, only the path did).

## Hooks to extract, in this order (one at a time, tests green between each)

1. **`useArticlePages`** (lines 88–160): the `getKey` for `useSWRInfinite`,
   the `useSWRInfinite` call, `allArticles`, and the crosspost grouping
   `useMemo` that yields `articles`, `groupCounts`, `absorbedIds` plus its
   ref. Input: the list identity (feed / category / folder / recommended /
   bookmarked / liked / read flags, `showReadArticles`, `noFloor`). Output:
   `{ articles, groupCounts, absorbedIds, data, error, size, setSize, isLoading, isValidating, mutate }`.
2. **`useAutoMarkRead`** — name clash with the preference hook in `src/hooks/`:
   call it **`useReadOnScroll`** (lines 321–370): `autoReadIds`, the
   `IntersectionObserver` ref, `batchQueue`, `flushTimerRef`, `flushBatch`,
   `scheduleFlush`, `markRead`, `markReadWithGroup`, `markReadRef`, and the
   `useEffect`s that attach the observer to the cards (find them: they
   reference `observerRef`). Keep `BATCH_FLUSH_INTERVAL` with it.
3. **`useLoadMoreSentinel`** (lines 273–320): `sentinelRef`, `loadMoreRef`,
   `sentinelObserverRef`, `sentinelCallbackRef` and the effect that keeps
   `loadMoreRef` current.
4. **`useKeyboardListSync`** (lines 162–198 and the effects at 181/187):
   publishes `articleIds`, `articleUrls`, `articleDates`, `lastListUrl` to the
   keyboard-navigation context and exposes `focusedItemId` / `setFocusedItemId`
   and `articleMap`.
5. **`useDayGroups`** (line 517 `dayGroups` memo and what it depends on).

What stays in the component: routing params, layout settings, the overlay
state, `showReadArticles` / `noFloor`, the escape-key debounce, touch/list
refs used by JSX, the render tree, `ArticleListSkeleton`.

Each hook gets a `*.test.ts(x)` with `renderHook` covering its observable
contract (the same behaviours the component tests pin: grouping absorbs
crossposts, read batching flushes after `BATCH_FLUSH_INTERVAL`, the sentinel
calls `setSize` once per intersection, the context receives the ids). Mock
`lib/fetcher`, `swr` and the context as `article-list.test.tsx` already does.

## Acceptance

- `article-list.tsx` under 350 lines; the five hooks in
  `src/features/reading/components/` (or a `hooks/` sibling; pick one and say
  which) each under 150 lines.
- `article-list.test.tsx` unmodified and green (its 4 fork tests and upstream's).
- The `ArticleList` props and `ArticleListHandle` unchanged.
- Typecheck, lint, both vitest projects, `npm run build` green; client test
  count goes up by the new hook tests.

Commit: `refactor(reading): split ArticleList into data, read-on-scroll, sentinel, keyboard-sync and day-group hooks`.
