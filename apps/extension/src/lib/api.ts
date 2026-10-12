import { createApiClient } from '@nightreel/api-client'

import { sessionStore } from '../storage'

// Only the service worker imports this: it is the one context that holds the token.
let accessToken: string | null = null

export async function loadSession() {
  accessToken = (await sessionStore.get()).accessToken ?? null
  return accessToken
}

export function setAccessToken(token: string | null) {
  accessToken = token
}

export const api = createApiClient({
  baseUrl: import.meta.env.WXT_API_URL ?? 'http://localhost:8000',
  getAccessToken: () => accessToken,
})
