import { createApiClient } from '@nightreel/api-client'

import { broadcast } from '../messaging/protocol'
import { env } from './env'
import { chromeTokenStorage, createSession, type RefreshOutcome } from './session'

// Only the service worker imports this module: it is the one context that holds tokens.

/** Unauthenticated client for the token endpoints, so a 401 there never re-enters a refresh. */
export const publicApi = createApiClient({ baseUrl: env.apiUrl })

export async function requestRefresh(refreshToken: string): Promise<RefreshOutcome> {
  try {
    const { data, response } = await publicApi.POST('/api/v1/auth/refresh', {
      body: { refresh_token: refreshToken },
    })
    if (response.ok && data) return { kind: 'ok', pair: data }
    return response.status >= 500 || response.status === 429
      ? { kind: 'transient' }
      : { kind: 'rejected' }
  } catch {
    return { kind: 'transient' }
  }
}

export const session = createSession({
  storage: chromeTokenStorage,
  refresh: requestRefresh,
  onExpired: () => broadcast({ type: 'session:changed' }),
})

/** Authenticated client. A 401 refreshes once (shared across requests) and retries. */
export const api = createApiClient({
  baseUrl: env.apiUrl,
  getAccessToken: session.getAccessToken,
  onUnauthorized: session.refresh,
})
