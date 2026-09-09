# 01 — `server/intelligence/`

Read `00-context.md` first.

## Goal

Gather the reading-intelligence features (rules, quality, interests, similarity,
trust, top stories, smart folders, front page) into `server/intelligence/`. Today
they sit in three places: the server root, `server/db/` and `server/routes/`.
**No behaviour change.**

## Moves (`git mv`, tests alongside)

| From | To |
|---|---|
| `server/rules.ts` | `server/intelligence/rules.ts` |
| `server/db/feed-rules.ts` | `server/intelligence/rules-db.ts` |
| `server/routes/rules.ts` (+ `.test.ts`) | `server/intelligence/rules-routes.ts` |
| `server/quality.ts` (+ `.test.ts`) | `server/intelligence/quality.ts` |
| `server/interests.ts` (+ `.test.ts`) | `server/intelligence/interests.ts` |
| `server/routes/interests.ts` (+ `.test.ts`) | `server/intelligence/interests-routes.ts` |
| `server/similarity.ts` (+ `.test.ts`) | `server/intelligence/similarity.ts` |
| `server/db/similarities.ts` (+ `.test.ts`) | `server/intelligence/similarity-db.ts` |
| `server/db/trust.ts` (+ `.test.ts`) | `server/intelligence/trust.ts` |
| `server/db/stories.ts` (+ `.test.ts`) | `server/intelligence/stories-db.ts` |
| `server/routes/stories.ts` (+ `.test.ts`) | `server/intelligence/stories-routes.ts` |
| `server/db/smart-folders.ts` | `server/intelligence/smart-folders-db.ts` |
| `server/routes/smart-folders.ts` (+ `.test.ts`) | `server/intelligence/smart-folders-routes.ts` |
| `server/db/frontpage.ts` | `server/intelligence/frontpage-db.ts` |
| `server/routes/frontpage.ts` (+ `.test.ts`) | `server/intelligence/frontpage-routes.ts` |

Inside each moved file, fix the relative imports (`../db.js` stays `../db.js`
for files that were at the root; files that came from `db/` or `routes/` mostly
keep the same depth too, but check each one).

## New files

### `server/intelligence/routes.ts`

```ts
export async function registerIntelligenceRoutes(api: FastifyInstance): Promise<void> {
  await api.register(frontPageRoutes)
  await api.register(smartFolderRoutes)
  await api.register(ruleRoutes)
  await api.register(storyRoutes)
  await api.register(interestRoutes)
}
```

Same relative order as today in `server/routes/index.ts` (lines 29 and 31–34;
`commentRoutes` at line 30 stays in `routes/index.ts` and now registers after
the block). Sibling plugin order does not affect URL matching.

### `server/intelligence/index.ts`

Exports what the rest of the server uses today:

- from `rules.ts`: `applyRulesToArticle` (ingest step), plus `compileRule`,
  `isValidPattern`, `ruleMatches`, `applyRuleToExisting`, `previewRule` if
  anything outside the domain imports them (check with grep; the routes file is
  inside the domain now).
- from `quality.ts`: `scoreArticleQuality`.
- from `interests.ts`: `scoreNewArticle`, `maybeRebuildInterestProfile`,
  `invalidateInterestProfile`, `recalculateInterestScores`, `_resetInterestsForTests`.
- from `similarity.ts`: `detectAndStoreSimilarArticles`, `computeTitleSimilarity`.
- from `similarity-db.ts`: `insertSimilarity`, `getSimilarArticles`,
  `findReadSimilarArticle`, `type SimilarArticle`.
- from `trust.ts`: `recalculateFeedTrust`, `getFeedTrust`.
- from `stories-db.ts`: `getTopStories`, `type Story`, `type StorySource`.
- from `routes.ts`: `registerIntelligenceRoutes`.

## Importers to update

- `server/routes/index.ts`: drop the five route imports and registrations
  (lines 11–15, 29, 31–34), import `registerIntelligenceRoutes` from
  `../intelligence/index.js` and `await` it where `frontPageRoutes` was.
- `server/db/index.ts`: remove the `similarities.js`, `trust.js`, `stories.js`
  export lines (the last five lines of the file).
- `server/index.ts`: line 12 `./interests.js` → `./intelligence/index.js`;
  `recalculateFeedTrust` on line 11 comes from `./intelligence/index.js` too
  (it was reaching it through `./db.js`).
- `server/chat/tools.ts` and `server/routes/articles.ts`: `getSimilarArticles`
  comes from `../intelligence/index.js` instead of `../db.js`.
- `server/ingest/steps/rules.ts`, `quality.ts`, `interests.ts`, `similarity.ts`:
  import from `../../intelligence/index.js`.
- Their tests `server/ingest/steps/{rules,quality,interests,similarity}.test.ts`:
  the `vi.mock('../../rules.js')` (etc.) becomes `vi.mock('../../intelligence/index.js')`
  with the same factory. Read each test: if the factory only stubs the one
  function the step calls, keep it that way.
- `server/similarity.test.ts` (now `intelligence/similarity.test.ts`): its
  `vi.mock('./db/similarities.js')` becomes `vi.mock('./similarity-db.js')`.
- `shared/types.ts` is untouched; `Story` / `StorySource` are server types and
  now come from the domain index.

Run `grep -rn "from '.*\(rules\|quality\|interests\|similarity\|similarities\|trust\|stories\|smart-folders\|feed-rules\|frontpage\)\.js'" server scripts --include=*.ts`
before committing and make sure every hit points inside `server/intelligence/`
or at `server/intelligence/index.js`.

## Acceptance

- `ls server/rules.ts server/quality.ts server/interests.ts server/similarity.ts server/db/feed-rules.ts server/db/similarities.ts server/db/trust.ts server/db/stories.ts server/db/smart-folders.ts server/db/frontpage.ts server/routes/rules.ts server/routes/interests.ts server/routes/stories.ts server/routes/smart-folders.ts server/routes/frontpage.ts` → every path missing.
- `grep -rn "intelligence/" server --include=*.ts | grep -v "^server/intelligence/" | grep -v "intelligence/index.js"` → empty (outside the domain, only the index is imported).
- Typecheck, lint, server tests green; test count unchanged (1,924).

Commit: `refactor(intelligence): gather rules, quality, interests, similarity, trust, stories, smart folders and front page under server/intelligence`.
