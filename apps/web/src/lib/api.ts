import { createApiClient, type components } from '@nightreel/api-client'
import { env } from './env'

type Schemas = components['schemas']
export type UserRead = Schemas['UserRead']
export type TokenPair = Schemas['TokenPair']
export type ProfileRead = Schemas['ProfileRead']
export type ProfileCreate = Schemas['ProfileCreate']
export type ShowRead = Schemas['ShowRead']
export type ContinueWatchingItem = Schemas['ContinueWatchingItem']
export type StreakRead = Schemas['StreakRead']
export type ProfileId = ProfileRead['id']
export type PartyRead = Schemas['PartyRead']

interface AuthBridge {
  getAccessToken: () => string | null
  onUnauthorized: () => Promise<boolean>
}

// lib sits below features, so the auth feature plugs its session in at startup
// (see features/auth installAuthBridge) instead of lib importing it.
let bridge: AuthBridge = { getAccessToken: () => null, onUnauthorized: async () => false }

export function bindAuth(next: AuthBridge): void {
  bridge = next
}

/** The single API client instance for the web app. */
export const api = createApiClient({
  baseUrl: env.VITE_API_URL,
  getAccessToken: () => bridge.getAccessToken(),
  onUnauthorized: () => bridge.onUnauthorized(),
})

export { ApiError, errorMessage, unwrap, type Problem } from './problem'
