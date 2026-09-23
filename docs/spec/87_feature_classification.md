# Oksskolten Spec — Article Classification

> [Back to Overview](./01_overview.md)

## Overview

Every article gets a **format** (what kind of piece it is: news, question, guide, review…) and a **theme** (what it is about, from a list the reader edits). Both come from the local vLLM server, read as a closed-choice decision: the options are shown as letters, the model answers one token with logprobs, and the letter probabilities give a verdict plus a margin ([notjev](https://github.com/9pings/notjev)). When the margin is too thin, the article stays unclassified rather than getting a guess.

Formats and themes show up in the sidebar with their unread counts (`/formats/:id`, `/themes/:id`), and as `format:` / `theme:` filters in smart folders.

## Motivation

- **Categories describe feeds, not articles**: a general tech site posts about phones, AI and cars in the same feed; a subreddit mixes help requests, news and debates. Per-article classes sort what the feed-level category cannot.
- **Format is a reading mode**: "questions from r/LocalLLM" and "news about AI" are different moments of reading, and no keyword or rule captures the difference.
- **One token is cheap and honest**: no generated text to parse, about 0.3 s per question on a local 8B-27B model, and a real probability to abstain on instead of a confident wrong label.

## Scope

- The vLLM provider settings only (base URL and API key): any OpenAI-compatible server that returns logprobs on `/v1/chat/completions` works (vLLM, llama.cpp `llama-server`). The model must be an instruct model, not a thinking one.
- One format and one theme per article. Multi-label tagging is out of scope.
- Feed categories stay in the database, the OPML export and Settings → Feeds. With `classify.hide_categories` on (the default once classification is enabled), the reading UI shows themes where it showed categories; turning it off brings the folders back unchanged.

## Design

### Formats and themes

`shared/classification.ts` holds the fixed format list (11 entries, `OTHER` last) and the default theme list. Each option has an `id` (stored, filtered on), a `label` (shown) and a `description` (read by the model). Themes are stored as JSON in the `classify.themes` setting, up to 26 (one letter each); ids are normalized to `[A-Z0-9_]` and derived from the label when missing.

### Decision

`server/ai/classify.ts` builds the article state (title, feed name, first 1,500 characters of the body) and asks two questions in sequence, so the second reuses the server's prefix cache. Each answer is `choice` or `null` when the margin between the two best options is below theta:

| Setting | Default | Meaning |
|---|---|---|
| `classify.enabled` | `off` | Master switch |
| `classify.model` | empty | vLLM model; empty falls back to `summary.model` |
| `classify.format_theta` | `0.5` | Minimum margin for a format |
| `classify.theme_theta` | `0.3` | Minimum margin for a theme (themes like AI / Computing overlap, and the top guess is usually right) |
| `classify.hide_categories` | `on` | Show themes instead of categories in the sidebar and the tab bar |

Server errors throw, so the queue retries. If neither question saw an option letter (`degraded`: no logprobs, or the model answered outside the menu) the call counts as a failure, not as "undecided".

### Pipeline

The `classify` ingest step (new and clipped articles) enqueues task `classify` on the AI queue, after the AI filter. The worker skips articles the filter hid, then writes `format`, `theme` and `classified_at`. `classify_pending_at` is the persistent marker the resume pass uses, like the other AI tasks.

`POST /api/classification/backfill` queues every active article with `classified_at IS NULL`, up to 5,000 per call, on a low-priority backlog drained only when the regular queue is empty, so new articles are translated and summarized first. Backfill items write no pending marker; after a restart the reader clicks again. `{ "all": true }` clears every verdict first (after editing the theme list).

### API

| Method | Path | Description |
|---|---|---|
| GET | `/api/classification` | `enabled`, `hideCategories` (only true while enabled), formats and themes with unread counts, `unclassified`, `pending` |
| GET | `/api/classification/settings` | Current settings |
| PATCH | `/api/classification/settings` | Update `enabled`, `model`, `formatTheta`, `themeTheta`, `themes`, `hideCategories` |
| POST | `/api/classification/test` | Classify `{ title, body? }` live, nothing stored |
| POST | `/api/classification/backfill` | Queue unclassified articles (`{ all: true }` to start over) |

`GET /api/articles` accepts `format` and `theme` (case-insensitive ids).

### Frontend

- Sidebar: "Themes" and "Formats" sections under smart folders, collapsible, hidden while classification is off.
- Hidden categories: the sidebar lists feeds flat, sorted by name, with drag-and-drop to folders disabled (there is no folder to drop into), and the tab bar above article lists (`category-tabs.tsx`) links to `/themes/:id` instead of `/categories/:id`.
- Settings → Integration → Article classification: switch, model, thresholds, theme editor, live test, backfill and reclassify.

### Key Files

| File | Description |
|---|---|
| `shared/classification.ts` | Formats, default themes, shared types |
| `server/ai/classify.ts` | Settings and the notjev decision |
| `server/ai/queue.ts` | `classify` task, backlog, resume |
| `server/ai/classify-routes.ts` | Classification API |
| `server/ingest/steps/classify.ts` | Enqueue on ingestion |
| `src/features/feeds/components/classification-list.tsx` | Sidebar sections |
| `src/features/settings/sections/classification-section.tsx` | Settings section |
| `scripts/format-eval.ts` | Offline evaluation against a real database |
