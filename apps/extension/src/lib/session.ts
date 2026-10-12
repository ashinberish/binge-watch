import { localStore, sessionStore } from '../storage'
import type { TokenPair } from './types'

/** Where tokens are kept. Swapped for an in-memory fake in tests. */
export interface TokenStorage {
  read(): Promise<{ accessToken: string | null; refreshToken: string | null }>
  write(pair: TokenPair): Promise<void>
  clear(): Promise<void>
}

export type RefreshOutcome =
  | { kind: 'ok'; pair: TokenPair }
  /** The API said no (revoked, expired, reused). The session is over. */
  | { kind: 'rejected' }
  /** Offline or the API is down. Keep the refresh token and try again later. */
  | { kind: 'transient' }

export interface SessionDeps {
  storage: TokenStorage
  refresh: (refreshToken: string) => Promise<RefreshOutcome>
  /** Called after a rejected refresh cleared the session. */
  onExpired?: () => void
}

/**
 * The service worker's token holder. The access token is cached in memory for the
 * synchronous getAccessToken() the API client needs, and reloaded from storage
 * whenever the worker wakes up.
 */
export function createSession({ storage, refresh, onExpired }: SessionDeps) {
  let accessToken: string | null = null
  let loading: Promise<void> | null = null
  let inflight: Promise<boolean> | null = null

  async function reload() {
    accessToken = (await storage.read()).accessToken
  }

  return {
    /** Loads the stored access token once per worker lifetime. */
    load(): Promise<void> {
      loading ??= reload()
      return loading
    },

    getAccessToken: (): string | null => accessToken,

    /** Signed in means a refresh token exists; the access token may be due a refresh. */
    async isSignedIn(): Promise<boolean> {
      return (await storage.read()).refreshToken !== null
    },

    async refreshToken(): Promise<string | null> {
      return (await storage.read()).refreshToken
    },

    async setTokens(pair: TokenPair): Promise<void> {
      accessToken = pair.access_token
      await storage.write(pair)
    },

    async clear(): Promise<void> {
      accessToken = null
      await storage.clear()
    },

    /**
     * Exchanges the stored refresh token for a new pair and stores the rotated one.
     * Concurrent callers (several requests hitting 401 at once) share one request,
     * since a rotated refresh token can only be used once.
     */
    refresh(): Promise<boolean> {
      inflight ??= (async () => {
        const { refreshToken } = await storage.read()
        if (!refreshToken) return false
        const outcome = await refresh(refreshToken)
        if (outcome.kind === 'ok') {
          accessToken = outcome.pair.access_token
          await storage.write(outcome.pair)
          return true
        }
        if (outcome.kind === 'rejected') {
          accessToken = null
          await storage.clear()
          onExpired?.()
        }
        return false
      })().finally(() => {
        inflight = null
      })
      return inflight
    },
  }
}

export type Session = ReturnType<typeof createSession>

/** chrome.storage-backed token storage: access token in session, refresh token in local. */
export const chromeTokenStorage: TokenStorage = {
  async read() {
    const [{ accessToken }, { refreshToken }] = await Promise.all([
      sessionStore.get(),
      localStore.get(),
    ])
    return { accessToken: accessToken ?? null, refreshToken: refreshToken ?? null }
  },
  async write(pair) {
    await Promise.all([
      sessionStore.set({
        accessToken: pair.access_token,
        accessExpiresAt: Date.now() + pair.expires_in * 1000,
      }),
      localStore.set({ refreshToken: pair.refresh_token }),
    ])
  },
  async clear() {
    await Promise.all([
      sessionStore.remove(['accessToken', 'accessExpiresAt']),
      localStore.remove(['refreshToken', 'displayName']),
    ])
  },
}
