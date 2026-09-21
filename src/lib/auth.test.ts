import { describe, it, expect, beforeEach, vi } from 'vitest'
// The module caches the token in a module-level variable, so we need
// a fresh module for each test to reset that cache.
describe('auth', () => {
  beforeEach(async () => {
    localStorage.clear()
    vi.resetModules()
    // setAuthToken mirrors the session into the media cookie over the network.
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(null, { status: 204 }))))
  })

  async function loadAuth() {
    const mod = await import('./auth')
    return mod
  }

  describe('getAuthToken', () => {
    it('returns null when no token stored', async () => {
      const { getAuthToken } = await loadAuth()
      expect(getAuthToken()).toBeNull()
    })

    it('returns token from localStorage', async () => {
      localStorage.setItem('auth_token', 'abc123')
      const { getAuthToken } = await loadAuth()
      expect(getAuthToken()).toBe('abc123')
    })

    it('caches token in memory after first read', async () => {
      localStorage.setItem('auth_token', 'abc123')
      const { getAuthToken } = await loadAuth()
      getAuthToken()
      // Even if localStorage changes, the cached value is returned
      localStorage.setItem('auth_token', 'changed')
      expect(getAuthToken()).toBe('abc123')
    })
  })

  describe('setAuthToken', () => {
    it('stores token in localStorage', async () => {
      const { setAuthToken } = await loadAuth()
      setAuthToken('tok_abc')
      expect(localStorage.getItem('auth_token')).toBe('tok_abc')
    })

    it('removes token from localStorage when null', async () => {
      localStorage.setItem('auth_token', 'existing')
      const { setAuthToken } = await loadAuth()
      setAuthToken(null)
      expect(localStorage.getItem('auth_token')).toBeNull()
    })

    it('updates the in-memory cache', async () => {
      const { setAuthToken, getAuthToken } = await loadAuth()
      setAuthToken('new_token')
      expect(getAuthToken()).toBe('new_token')
    })
  })

  // Archived images and videos are <img>/<video> loads: they cannot send the
  // Authorization header, so the session is mirrored into a cookie for them.
  describe('syncMediaCookie', () => {
    it('asks the server for a cookie when a session starts', async () => {
      const { setAuthToken } = await loadAuth()
      setAuthToken('tok_abc')

      expect(fetch).toHaveBeenCalledWith('/api/auth/media-cookie', {
        method: 'POST',
        headers: { Authorization: 'Bearer tok_abc' },
      })
    })

    it('drops the cookie when the session ends', async () => {
      const { setAuthToken } = await loadAuth()
      setAuthToken(null)

      expect(fetch).toHaveBeenCalledWith('/api/auth/media-cookie', { method: 'DELETE' })
    })

    it('stays quiet when the request fails', async () => {
      vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))))
      const { syncMediaCookie } = await loadAuth()

      await expect(syncMediaCookie('tok_abc')).resolves.toBeUndefined()
    })
  })

  describe('logoutClient', () => {
    it('clears token and dispatches logout event', async () => {
      const { setAuthToken, logoutClient, getAuthToken, AUTH_LOGOUT_EVENT } = await loadAuth()
      setAuthToken('tok_abc')

      const handler = vi.fn()
      window.addEventListener(AUTH_LOGOUT_EVENT, handler)

      const replaceStateSpy = vi.spyOn(window.history, 'replaceState')
      logoutClient()

      expect(getAuthToken()).toBeNull()
      expect(localStorage.getItem('auth_token')).toBeNull()
      expect(replaceStateSpy).toHaveBeenCalledWith({}, '', '/')
      expect(handler).toHaveBeenCalledTimes(1)

      window.removeEventListener(AUTH_LOGOUT_EVENT, handler)
      replaceStateSpy.mockRestore()
    })
  })
})
