# Oksskolten Spec — Discord Channels

> [Back to Overview](./01_overview.md)

## Overview

Follow a Discord channel as a feed. Pasting a channel URL — `https://discord.com/channels/<guild>/<channel>`, as copied from the Discord app — creates one feed whose articles are that channel's messages.

## Motivation

- **No feed, and no page to read either**: Discord publishes no RSS, and its web app is a login wall, so neither discovery nor scraping reaches a channel. The REST API does, with a bot token.
- **Announcement channels are where release notes live**: many projects post to Discord and nowhere else, which today means opening the app to find out.
- **The message is the whole article**: a message carries its own text, so the reader never needs to leave for the source — which is just as well, since the permalink is unreadable without an account.

## Scope

Channels in a server the bot has been invited to. Direct messages (`/channels/@me/…`) are rejected outright: a bot cannot read them, and accepting the URL would create a feed that fails on every fetch. Threads, forum posts and reactions are out of scope.

## Design

### URL Recognition

`parseDiscordChannelUrl()` in `server/feeds/sources/discord-channel.ts` accepts the channel URL and the message permalink (`…/<guild>/<channel>/<message>`), since both name the same channel, and requires both ids to be snowflakes. `discordChannelFeedUrl()` collapses them to the canonical channel URL, so one channel cannot be subscribed to twice, and the stored URL stays a link that opens the channel in Discord.

`resolveFeedSource()` runs `resolveDiscordChannelFeed()` as its own stage, after the GitHub resolvers and before the social one. A match short-circuits the discovery / RSS Bridge / CSS-selector pipeline. The resolver reads the channel's name once, at create time, to name the feed `Discord #announcements`; without a token, or when the bot cannot see the channel yet, the feed is still created under the plain name `Discord` — the fetch is what surfaces that problem, with an error the user can act on.

### Authentication

A bot token is required: the API rejects anonymous requests, and Discord grants channel access per bot, not per token. The bot must be a member of the server with **View Channel** and **Read Message History** on the channel.

`getDiscordBotToken()` checks the `discord.bot_token` DB setting first, falling back to the `DISCORD_BOT_TOKEN` environment variable. The setting is what Settings → Integration writes to, through the same `/api/settings/api-keys/:provider` route the LLM and GitHub keys use — a token entered there takes effect on the next fetch cycle with no restart.

### Fetching

`fetchAndParseRss()` routes channel URLs to `fetchDiscordChannel()`, alongside the GitHub and Bluesky URLs it already routes. These feeds have no RSS endpoint to fetch conditionally, so ETag / Last-Modified / content-hash caching does not apply and the result reports `notModified: false`.

One request per cycle — `GET /channels/:id/messages?limit=50` — returns the channel's recent messages. Failures are translated into what the user has to do about them: 401 names the token, 403 names the invite and the two permissions, 404 says the bot may not be in the server, and 429 becomes a `RateLimitError` so the feed backs off on Discord's own `Retry-After` instead of hammering it.

Only message types `0` (plain) and `19` (reply) are kept. Every other type is Discord's own chrome — joins, boosts, pins, call notices — which would arrive as empty articles.

### Item Shape

Each message becomes an `RssItem`: the title is the first line of the message, truncated at 120 characters the way Bluesky posts are, or `Message from <author>` when the message is an embed or an attachment alone. The URL is the message permalink, unique per message, which is what dedup keys on. The excerpt is the whole message — text, then each embed's title / description / link, then each attachment as `filename: url`.

`fetchArticleContent()` treats a Discord permalink as self-contained, the same way it treats an anchor link: the fetch is skipped and the excerpt becomes the body. Fetching the permalink would return the web app's shell, never the message, and the feed already carries the whole thing.

### Key Files

| File | Description |
|---|---|
| `server/feeds/sources/discord-channel.ts` | URL parsing, token resolution, channel name, message fetch and mapping |
| `server/feeds/resolve.ts` | `discord` resolver stage, before the social resolver |
| `server/fetcher/rss/fetch.ts` | Routes channel URLs to the API instead of an RSS fetch |
| `server/ingest/fetch-content.ts` | Treats a message permalink as self-contained, skipping the fetch |
| `server/ai/settings-routes.ts` | `discord` entry in `PROVIDER_KEY_MAP` (`discord.bot_token`) |
| `src/features/settings/sections/discord-section.tsx` | Settings → Integration section: token, channel URL |
| `src/features/settings/lib/create-feed-from-url.ts` | Shared SSE create-feed call, used by the GitHub and Discord sections |
