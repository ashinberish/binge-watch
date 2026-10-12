import { create } from 'zustand'
import { bindAuth, type TokenPair } from '@/lib/api'
import { env } from '@/lib/env'

const REFRESH_KEY = 'nightreel.refresh_token'

// TODO(hardening): move the refresh token out of localStorage into an httpOnly,
// Secure, SameSite=Strict cookie set by the API, and drop it from the JSON body.
// localStorage is readable by any script on the origin (XSS exposure).
function readRefreshToken(): string | null {
  try {
    return localStorage.getItem(REFRESH_KEY)
  } catch {
    return null
  }
}

function writeRefreshToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(REFRESH_KEY, token)
    else localStorage.removeItem(REFRESH_KEY)
  } catch {
    // Storage unavailable (private mode); session lasts until reload.
  }
}

interface SessionState {
  /** Access token lives in memory only. */
  accessToken: string | null
  /** Epoch ms when the access token expires. */
  expiresAt: number | null
  setTokens: (pair: TokenPair) => void
  clear: () => void
}

export const useSession = create<SessionState>()((set) => ({
  accessToken: null,
  expiresAt: null,
  setTokens: (pair) => {
    writeRefreshToken(pair.refresh_token)
    set({ accessToken: pair.access_token, expiresAt: Date.now() + pair.expires_in * 1000 })
  },
  clear: () => {
    writeRefreshToken(null)
    set({ accessToken: null, expiresAt: null })
  },
}))

export const getRefreshToken = readRefreshToken

let inflight: Promise<boolean> | null = null

/**
 * Exchanges the stored refresh token for a new pair. Concurrent callers share one request.
 * Uses fetch directly (not the API client) so a 401 here cannot re-enter onUnauthorized.
 */
export function refreshSession(): Promise<boolean> {
  inflight ??= (async () => {
    const refreshToken = readRefreshToken()
    if (!refreshToken) return false
    try {
      const res = await fetch(`${env.VITE_API_URL}/api/v1/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: refreshToken }),
      })
      if (!res.ok) {
        useSession.getState().clear()
        return false
      }
      useSession.getState().setTokens((await res.json()) as TokenPair)
      return true
    } catch {
      // Network failure: keep the refresh token so a later attempt can succeed.
      return false
    }
  })().finally(() => {
    inflight = null
  })
  return inflight
}

/** True when there is (or can be restored) a signed-in session. Used by route guards. */
export async function ensureSession(): Promise<boolean> {
  if (useSession.getState().accessToken) return true
  return refreshSession()
}

/** Connects the session to the shared API client. Call once at startup. */
export function installAuthBridge(): void {
  bindAuth({
    getAccessToken: () => useSession.getState().accessToken,
    onUnauthorized: refreshSession,
  })
}
