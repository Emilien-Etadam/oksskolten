import { describe, it, expect } from 'vitest'
import path from 'node:path'
import { resolveDataDir, dataPath, databaseDir, formerDataDirs } from './paths.js'

describe('resolveDataDir', () => {
  it('uses DATA_DIR env when set', () => {
    expect(resolveDataDir('/custom/data', () => false, '/home/user'))
      .toBe('/custom/data')
  })

  it('resolves relative DATA_DIR to absolute', () => {
    const result = resolveDataDir('relative/path', () => false, '/home/user')
    expect(path.isAbsolute(result)).toBe(true)
    expect(result).toBe(path.resolve('relative/path'))
  })

  it('uses ./data when the directory exists and DATA_DIR is unset', () => {
    expect(resolveDataDir(undefined, () => true, '/home/user'))
      .toBe(path.resolve('data'))
  })

  it('falls back to ~/.oksskolten/data when ./data does not exist', () => {
    expect(resolveDataDir(undefined, () => false, '/home/user'))
      .toBe('/home/user/.oksskolten/data')
  })

  it('DATA_DIR takes precedence over ./data', () => {
    expect(resolveDataDir('/override', () => true, '/home/user'))
      .toBe('/override')
  })

  // A bare-metal install kept its database in /var/lib and its archived
  // images wherever the server was started from: they went missing when
  // ./data appeared and the next start looked there instead.
  it('follows a local database file when DATA_DIR is unset, whatever the working directory', () => {
    expect(resolveDataDir(undefined, () => true, '/home/user', 'file:/var/lib/oksskolten/data/rss.db'))
      .toBe('/var/lib/oksskolten/data')
    expect(resolveDataDir(undefined, () => false, '/home/user', 'file:/var/lib/oksskolten/data/rss.db'))
      .toBe('/var/lib/oksskolten/data')
  })

  it('DATA_DIR takes precedence over the database directory', () => {
    expect(resolveDataDir('/override', () => false, '/home/user', 'file:/var/lib/oksskolten/data/rss.db'))
      .toBe('/override')
  })

  it('ignores databases that are not a local file', () => {
    expect(resolveDataDir(undefined, () => true, '/home/user', ':memory:')).toBe(path.resolve('data'))
    expect(resolveDataDir(undefined, () => false, '/home/user', 'libsql://db.turso.io')).toBe('/home/user/.oksskolten/data')
  })
})

describe('databaseDir', () => {
  it('reads the directory of a file: URL in its path and URL forms', () => {
    expect(databaseDir('file:/data/rss.db')).toBe('/data')
    expect(databaseDir('file:///var/lib/oksskolten/data/rss.db')).toBe('/var/lib/oksskolten/data')
    expect(databaseDir('file:/data/rss.db?mode=rwc')).toBe('/data')
  })

  it('resolves a relative database path against the working directory', () => {
    expect(databaseDir('file:./data/rss.db')).toBe(path.resolve('data'))
    expect(databaseDir('rss.db')).toBe(path.resolve('.'))
  })

  it('returns null for no database, an in-memory one, or a remote one', () => {
    expect(databaseDir(undefined)).toBeNull()
    expect(databaseDir(':memory:')).toBeNull()
    expect(databaseDir('file::memory:')).toBeNull()
    expect(databaseDir('libsql://db.turso.io')).toBeNull()
    expect(databaseDir('https://db.example.com')).toBeNull()
  })
})

describe('formerDataDirs', () => {
  it('lists the working-directory and home fallbacks', () => {
    expect(formerDataDirs('/home/user')).toEqual([path.resolve('data'), '/home/user/.oksskolten/data'])
  })
})

describe('dataPath', () => {
  it('joins segments to DATA_DIR', () => {
    const result = dataPath('rss.db')
    expect(path.isAbsolute(result)).toBe(true)
    expect(result.endsWith('rss.db')).toBe(true)
  })

  it('joins multiple segments', () => {
    const result = dataPath('articles', 'images')
    expect(result.endsWith(path.join('articles', 'images'))).toBe(true)
  })
})
