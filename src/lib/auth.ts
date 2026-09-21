let _token: string | null = null
export const AUTH_LOGOUT_EVENT = 'reader:auth-logout'

export function getAuthToken(): string | null {
  if (_token == null) {
    _token = localStorage.getItem('auth_token')
  }
  return _token
}

export function setAuthToken(token: string | null): void {
  _token = token
  if (token) {
    localStorage.setItem('auth_token', token)
  } else {
    localStorage.removeItem('auth_token')
  }
  void syncMediaCookie(token)
}

/**
 * Mirror the session into the media cookie, the only credential the browser
 * can send by itself. Archived images and videos are loaded by <img> and
 * <video> tags, which never carry the Authorization header the rest of the
 * API runs on, so without this they answer 401 and render as broken.
 *
 * Failure is silent on purpose: nothing but archived media depends on it, and
 * a login must not fail because a cookie could not be stored.
 */
export async function syncMediaCookie(token: string | null): Promise<void> {
  try {
    await fetch('/api/auth/media-cookie', token
      ? { method: 'POST', headers: { Authorization: `Bearer ${token}` } }
      : { method: 'DELETE' })
  } catch {
    // offline, or the server is down — the next boot asks again
  }
}

export function logoutClient(): void {
  setAuthToken(null)
  window.history.replaceState({}, '', '/')
  window.dispatchEvent(new Event(AUTH_LOGOUT_EVENT))
}
