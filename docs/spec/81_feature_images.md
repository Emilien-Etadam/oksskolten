# Oksskolten Spec — Image Archive

> [Back to Overview](./01_overview.md)

## Overview

A feature that downloads images in article Markdown (`![alt](url)`), saves them locally or uploads them to a remote host, and rewrites the URLs. This protects against broken links when the original images become unavailable.

## Motivation

Hotlinked images become inaccessible when the original article is deleted or the hosting service goes down. For articles worth keeping long-term, archiving images locally (or to a remote host) ensures the reading experience is preserved indefinitely.

## Design

### Enabling

Enable by setting `images.enabled` to `'1'` or `'true'` in the settings table. This can be toggled from the settings page (`/settings/ai`).

### Processing Flow (`archiveArticleImages()`)

```
POST /api/articles/:id/archive-images
    │
    ├─ Precondition checks: article exists / full_text present / feature enabled / not yet archived
    ├─ Return 202 Accepted immediately
    │
    └─ Background processing:
        │
        ├─ Extract image URLs from Markdown via regex: /!\[([^\]]*)\]\(([^)]+)\)/g
        │
        ├─ Skip the following:
        │   - Already local URLs (/api/articles/images/...)
        │   - data: URIs
        │
        ├─ Download images with safeFetch() (30-second timeout)
        │   - If Content-Length or actual buffer size exceeds max_size_mb → skip
        │
        ├─ Filename: {articleId}_{sha256(url).slice(0,12)}{ext}
        │
        ├─ Local mode:
        │   - Save to images.storage_path (default: data/articles/images/)
        │   - Rewrite URL to /api/articles/images/{filename}
        │
        ├─ Remote mode:
        │   - POST FormData to images.upload_url
        │   - Extract URL from response using images.upload_resp_path
        │   - On failure, keep the original URL (partial success is acceptable)
        │
        ├─ UPDATE full_text with the rewritten text
        └─ Record timestamp via markImagesArchived(articleId)
```

### Automatic Archiving Per Feed

By default, archiving runs when the reader opens an article (the client calls `POST /api/articles/:id/archive-images`). For feeds kept as archives, waiting for someone to open each article defeats the purpose — the local copy must exist before the source rots. Feeds with `archive_images = 1` (toggled from the feed's context menu, persisted via `PATCH /api/feeds/:id`) have their articles' images archived automatically by `sweepAutoArchiveFeeds()` (`server/fetcher/article-images.ts`):

- **At the end of every fetch cycle** (`fetchAllFeeds` and `fetchSingleFeed`), fire-and-forget so downloads never hold up the batch. Each sweep processes up to 50 not-yet-archived articles per feed (`SWEEP_LIMIT_PER_CYCLE`), newest first; whatever remains drains on later cycles.
- **When the flag is switched on**, the `PATCH /api/feeds/:id` handler kicks one large sweep (`SWEEP_LIMIT_BACKLOG`, 10,000 articles) so the feed's existing backlog is archived immediately, not only future articles.

The sweep selects articles via `getUnarchivedArticlesByFeed()` (`images_archived_at IS NULL` and a non-empty `full_text`). Imageless articles are included on purpose: one pass marks them archived and permanently off the queue, the same terminal state the on-open path produces. An in-flight set guards against two concurrent sweeps of the same feed downloading the same images twice.

The per-feed flag piggybacks on the global feature: while `images.enabled` is off, sweeps are a no-op, since they reuse the same storage configuration (local path or remote upload).

### Image Serving

Images archived in local mode are served via `GET /api/articles/images/:filename`.

- Path traversal protection: `path.basename(filename) !== filename || filename.includes('..')` → 400
- MIME type: based on file extension (`.jpg`, `.jpeg`, `.png`, `.gif`, `.webp`, `.svg`, `.avif`)
- Cache: `Cache-Control: public, max-age=31536000, immutable`

### Image Deletion

When an article is deleted, if `images_archived_at` is set, `deleteArticleImages(articleId)` is called. All files matching `{articleId}_*` in the local images directory are deleted.

### Remote Upload Settings

Settings for uploading to an arbitrary image hosting service:

| Setting | Description | Example |
|---|---|---|
| `mode` | Set to `'remote'` | `remote` |
| `url` | Upload endpoint | `https://imghost.example.com/api/upload` |
| `headers` | HTTP headers (JSON string) | `{"Authorization":"Bearer xxx"}` |
| `fieldName` | Form field name | `image` |
| `respPath` | Dot-path to extract URL from response | `data.url` |

`extractByDotPath(obj, dotPath)` traverses the nested path in the response JSON to retrieve the URL. If the configuration is incomplete (`upload_url` or `upload_resp_path` not set), processing is skipped.

A test upload (`POST /api/settings/image-storage/test`) sends a 1x1 transparent PNG to verify that the settings are configured correctly.
