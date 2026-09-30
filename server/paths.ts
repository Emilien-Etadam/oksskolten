import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'

/**
 * Directory of the database file DATABASE_URL points at, or null when it is
 * not a local file (unset, in memory, or a remote libsql / Turso URL).
 */
export function databaseDir(databaseUrl: string | undefined): string | null {
  if (!databaseUrl) return null
  let filePath: string
  if (databaseUrl.startsWith('file://')) {
    try {
      filePath = decodeURIComponent(new URL(databaseUrl).pathname)
    } catch {
      return null
    }
  } else if (databaseUrl.startsWith('file:')) {
    filePath = databaseUrl.slice('file:'.length).split('?')[0]
  } else if (/^[a-z][a-z0-9+.-]+:/i.test(databaseUrl)) {
    return null // libsql://, https://, ws://… — nothing on this disk
  } else {
    filePath = databaseUrl
  }
  if (!filePath || filePath.includes(':memory:')) return null
  return path.dirname(path.resolve(filePath))
}

/**
 * Resolve the data directory.
 *
 * Priority:
 *   1. DATA_DIR environment variable (explicit override)
 *   2. The directory of the database, when DATABASE_URL names a local file:
 *      archived images and videos belong next to it, whatever directory the
 *      server happens to be started from
 *   3. ./data (when running inside the project — dev / Docker container)
 *   4. ~/.oksskolten/data (standalone: SSH + MCP server, etc.)
 */
export function resolveDataDir(
  env: string | undefined = process.env.DATA_DIR,
  localExists: () => boolean = () => {
    try { return fs.statSync(path.resolve('data')).isDirectory() } catch { return false }
  },
  homedir: string = os.homedir(),
  databaseUrl: string | undefined = process.env.DATABASE_URL,
): string {
  if (env) {
    return path.resolve(env)
  }

  const dbDir = databaseDir(databaseUrl)
  if (dbDir) {
    return dbDir
  }

  if (localExists()) {
    return path.resolve('data')
  }

  return path.join(homedir, '.oksskolten', 'data')
}

/**
 * Where archived media may sit from runs that resolved the data directory
 * differently: before step 2 above existed, the directory followed the
 * working directory (`./data`) or fell back to the home directory. Used to
 * recover files an article still points at.
 */
export function formerDataDirs(homedir: string = os.homedir()): string[] {
  return [path.resolve('data'), path.join(homedir, '.oksskolten', 'data')]
}

export const DATA_DIR = resolveDataDir()

export function dataPath(...segments: string[]): string {
  return path.join(DATA_DIR, ...segments)
}

/**
 * Find the project root directory by walking up from __dirname until
 * package.json is found. Works under both tsx (source) and compiled
 * (dist/ or dist-server/) environments where __dirname depth differs.
 *
 * Assumes a single-package layout (no monorepo workspaces) where the
 * first package.json walking upward is the project root. Will produce
 * incorrect results in a multi-package workspace with nested
 * package.json files.
 */
export function findProjectRoot(dirname: string): string {
  let dir = dirname
  while (true) {
    if (fs.existsSync(path.join(dir, 'package.json'))) return dir
    const parent = path.dirname(dir)
    if (parent === dir) return dir // hit filesystem root
    dir = parent
  }
}
