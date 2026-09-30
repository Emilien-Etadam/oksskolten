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
        │   - Save to images.storage_path (default: {data dir}/articles/images/, see below)
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
- MIME type: sniffed from the file's first bytes (PNG, JPEG, GIF, WebP, AVIF, SVG), falling back to the extension. At download time a body that is not an image is not stored and the article keeps the remote URL; the stored file is named after its real format, since CDNs such as Blogger re-encode images under the original name
- Cache: `Cache-Control: public, max-age=31536000, immutable`
- Authentication: `requireMediaAuth`, not the `requireAuth` the rest of the API uses. The reader reaches this URL through an `<img>` tag the browser loads by itself, with no chance to attach the `Authorization` header the session runs on; every archived image would answer 401 and render broken. The request therefore also authenticates with the `media_token` cookie — the same JWT, `HttpOnly`, scoped to `/api/articles` (`docs/spec/40_auth.md`). This is why the route is registered outside the authenticated scope in `server/routes/index.ts`.

### Storage Location

Without `images.storage_path`, images are stored under `{data dir}/articles/images/` (videos under `{data dir}/articles/videos/`). The data dir comes from `resolveDataDir()` (`server/paths.ts`): `DATA_DIR` when set, otherwise the directory of the database file when `DATABASE_URL` names a local file, otherwise `./data` if it exists in the working directory, otherwise `~/.oksskolten/data`.

The database step keeps archived media next to the database whatever directory the server is started from. Before it existed, a bare-metal install with `DATABASE_URL=file:/var/lib/oksskolten/data/rss.db` stored its images under `~/.oksskolten/data` while `/opt/oksskolten/data` did not exist, then looked for them under `/opt/oksskolten/data` once that directory appeared: every archived image answered `404 Image not found`. The Docker compose files set `DATABASE_URL=file:/data/rss.db`, so media now land on the `/data` volume instead of `/app/data` inside the container.

### Lost Archives (`repairLostArchivedImages()`)

Once archived, an article's text points at `/api/articles/images/{file}`. If that file disappears — the storage directory was wiped, moved, or is not the one the serving process reads — the reader shows a broken image and the original URL is no longer in the text. `repairLostArchivedImages()` (`server/fetcher/article-images.ts`) runs in the background at every startup:

- Walks archived articles whose `full_text` or `full_text_translated` contains `/api/articles/images/` (`getArticlesWithLocalImages()`, 50 per batch, in id order) and checks that each referenced file exists in the images directory. Articles whose files are all present cost one existence check per image.
- Looks for each missing file in the directories earlier runs may have used — `./data/articles/images` in the working directory, `~/.oksskolten/data/articles/images` (`formerDataDirs()`), and the default location when a custom `images.storage_path` is set — and copies it back when what sits there is a picture (`sniffImageFile()`). The text is left alone and the old copy stays in place.
- For each file still missing, recovers the URL it was downloaded from. The file name holds `sha256(sourceUrl).slice(0, 12)` (`archivedImageHash()`), so a candidate URL either is the source or is not: the article's stored `og_image` first (the hero `ensureLeadImage()` prepends), then the images of the page extracted again with `fetchFullText()` (only when `og_image` did not account for every file).
- An image still untraced falls back to the target of the link wrapping it (`[![alt](local)](href)`) when that target is a picture: an image extension, or a `googleusercontent.com` / `bp.blogspot.com` host, since Blogger links every picture to its full-size original.
- Replaces the local URL with the recovered one in `full_text` and `full_text_translated`, clears `images_archived_at`, and sweeps the article's feed (`sweepAutoArchiveFeeds(feedId, SWEEP_LIMIT_BACKLOG)`) so feeds with auto-archive download the pictures again.
- An image with no recoverable source keeps its local URL and its article stays archived; the next startup tries again. The pass logs one warning for the copied files (with the directories they came from) and one for the restored URLs, naming the images directory it checked.

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
