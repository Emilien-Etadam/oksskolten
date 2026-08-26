#!/usr/bin/env node --import tsx
/**
 * Diagnose how a Google News link resolves to its publisher.
 *
 * Walks the same strategies as `resolveGoogleNewsUrl()` one at a time —
 * decoding the token, following the redirect, reading the shell, replaying the
 * signed RPC — printing what each one saw. When resolution fails, the point of
 * failure and a slice of Google's HTML are what the patterns have to be
 * adjusted against.
 *
 * Usage:
 *   node --import tsx scripts/debug-google-news.ts <google-news-url>
 *   node --import tsx scripts/debug-google-news.ts <url> --dump-html shell.html
 */
import fs from 'node:fs'
import { safeFetch } from '../server/fetcher/ssrf.js'
import { USER_AGENT, DEFAULT_TIMEOUT, decodeResponse } from '../server/fetcher/http.js'
import { fetchViaFlareSolverr } from '../server/fetcher/flaresolverr.js'
import {
  isGoogleNewsUrl,
  decodeGoogleNewsToken,
  extractPublisherUrl,
  resolveGoogleNewsUrl,
} from '../server/fetcher/google-news.js'

const args = process.argv.slice(2)
const url = args.find(a => !a.startsWith('--'))
const dumpIndex = args.indexOf('--dump-html')
const dumpPath = dumpIndex >= 0 ? args[dumpIndex + 1] : null

if (!url) {
  console.error('Usage: node --import tsx scripts/debug-google-news.ts <google-news-url> [--dump-html shell.html]')
  process.exit(1)
}

function line(label: string, value: unknown): void {
  console.log(`${label.padEnd(26)} ${value === null || value === undefined ? '—' : String(value)}`)
}

console.log('\n=== Google News resolution ===\n')
line('URL', url.slice(0, 100) + (url.length > 100 ? '…' : ''))
line('1. recognised as wrapper', isGoogleNewsUrl(url))

if (!isGoogleNewsUrl(url)) {
  console.log('\nNot a Google News article link — nothing to resolve.\n')
  process.exit(0)
}

const decoded = decodeGoogleNewsToken(url)
line('2. token decodes to', decoded)
if (decoded) {
  console.log('\nResolved by decoding alone — no network needed.\n')
  process.exit(0)
}
console.log('   (opaque token: post-2024 link, Google resolves it at runtime)')

let shell = ''
try {
  const res = await safeFetch(url, {
    headers: { 'User-Agent': USER_AGENT },
    redirect: 'follow',
    signal: AbortSignal.timeout(DEFAULT_TIMEOUT),
  })
  line('3. fetch status', res.status)
  line('   final URL', res.url.slice(0, 100))
  if (res.ok) {
    shell = await decodeResponse(res)
    line('   shell length', `${shell.length} chars`)
    line('   publisher link in shell', extractPublisherUrl(shell))
    line('   data-n-a-sg present', /data-n-a-sg="([^"]+)"/.test(shell))
    line('   data-n-a-ts present', /data-n-a-ts="([^"]+)"/.test(shell))
    line('   data-n-a-id present', /data-n-a-id="([^"]+)"/.test(shell))
  }
} catch (err) {
  line('3. fetch failed', err instanceof Error ? err.message : err)
}

if (dumpPath && shell) {
  fs.writeFileSync(dumpPath, shell)
  line('   shell written to', dumpPath)
}

const flare = await fetchViaFlareSolverr(url).catch(() => null)
line('4. FlareSolverr', flare ? `final URL ${flare.url.slice(0, 80)}` : 'unavailable or failed')

const resolved = await resolveGoogleNewsUrl(url)
console.log()
line('RESOLVED', resolved)
console.log()

if (!resolved && shell) {
  console.log('First 600 chars of the shell, for pattern work:\n')
  console.log(shell.slice(0, 600).replace(/\s+/g, ' '))
  console.log()
}
