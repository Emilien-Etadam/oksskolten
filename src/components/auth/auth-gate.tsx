import { useCallback, useEffect, useRef, useState } from 'react'
import useSWR from 'swr'
import { AUTH_LOGOUT_EVENT, getAuthToken, setAuthToken, syncMediaCookie } from '../../lib/auth'
import { LoginPage } from '../../pages/login-page'

// AuthGate uses its own fetcher that does NOT redirect on 401.
// The global fetcher calls window.location.href = '/' on 401, which causes
// an infinite reload loop when unauthenticated. AuthGate handles 401 by
// showing LoginPage instead.
const meFetcher = (url: string) => {
  const token = getAuthToken()
  return fetch(url, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  }).then(r => {
    if (!r.ok) throw new Error('Unauthorized')
    return r.json()
  })
}

export function AuthGate({ children }: { children: React.ReactNode }) {
  const [exchanging, setExchanging] = useState(false)
  const { data, error, isLoading, mutate } = useSWR<{ email: string }>('/api/me', meFetcher, {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    errorRetryCount: 0,
  })

  const handleLogin = useCallback((token: string) => {
    setAuthToken(token)
    void mutate()
  }, [mutate])

  // A session that predates the media cookie — or whose cookie has expired —
  // only learns about it here: nothing else in a returning visit touches the
  // token, and archived images answer 401 until the cookie is back.
  const mediaCookieSynced = useRef(false)
  useEffect(() => {
    if (!data || mediaCookieSynced.current) return
    mediaCookieSynced.current = true
    void syncMediaCookie(getAuthToken())
  }, [data])

  useEffect(() => {
    const handleLogout = () => {
      void mutate(undefined, { revalidate: false })
    }

    window.addEventListener(AUTH_LOGOUT_EVENT, handleLogout)
    return () => window.removeEventListener(AUTH_LOGOUT_EVENT, handleLogout)
  }, [mutate])

  // OAuth exchange code handling
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const code = params.get('oauth_code')
    if (!code) return

    // Clean URL immediately
    params.delete('oauth_code')
    const clean = params.toString()
    window.history.replaceState({}, '', clean ? `/?${clean}` : '/')

    setExchanging(true)
    fetch('/api/oauth/github/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    })
      .then(res => res.ok ? res.json() : Promise.reject())
      .then(data => {
        setAuthToken(data.token)
        void mutate()
      })
      .catch(() => { /* LoginPage will show via error state */ })
      .finally(() => setExchanging(false))
  }, [mutate])

  if (isLoading || exchanging) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-bg text-text">
        <div className="rounded-full border-2 border-border border-t-accent h-8 w-8 animate-spin" aria-label="Loading" />
      </div>
    )
  }
  if (error || !data) return <LoginPage onLogin={handleLogin} />

  return <>{children}</>
}
