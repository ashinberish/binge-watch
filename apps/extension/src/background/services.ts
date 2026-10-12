import type { PlaybackSnapshot } from '../adapters/types'
import { api, publicApi, session } from '../lib/api'
import { connectUrl, parseCodeFromRedirect } from '../lib/auth-flow'
import { env } from '../lib/env'
import { fail, ok, request, type Result } from '../lib/result'
import { normalizeSettings } from '../lib/settings'
import type { MatchResult, Profile } from '../lib/types'
import { broadcast, sendToTab, type SessionState, type Settings } from '../messaging/protocol'
import { createPartyConnection, webSocketFactory } from '../party/connection'
import { partySocketUrl } from '../party/protocol'
import { createPartyRooms, type PartyApi } from '../party/rooms'
import { localStore, serialized, sessionStore } from '../storage'
import { cachedMatch, matchKey, writeCachedMatch } from '../sync/match-cache'
import { clearQueue, createFlushScheduler, flush, push, type FlushDeps } from '../sync/queue'
import type { Services } from './handler'

const CONTINUE_WATCHING_LIMIT = 5

// ---------------------------------------------------------------------------
// Session

async function sessionState(): Promise<SessionState> {
  const signedIn = await session.isSignedIn()
  const { displayName } = await localStore.get()
  return { signedIn, displayName: signedIn ? (displayName ?? null) : null }
}

async function loadDisplayName(): Promise<void> {
  const me = await request(() => api.GET('/api/v1/users/me'))
  if (me.ok) await localStore.set({ displayName: me.data.display_name })
}

async function signIn(): Promise<Result<SessionState>> {
  const redirectUri = chrome.identity.getRedirectURL()
  let responseUrl: string | undefined
  try {
    responseUrl = await chrome.identity.launchWebAuthFlow({
      url: connectUrl(env.webUrl, redirectUri),
      interactive: true,
    })
  } catch {
    // The viewer closed the window, or the web app never redirected back.
    return fail('cancelled')
  }
  const code = parseCodeFromRedirect(responseUrl, redirectUri)
  if (!code) return fail('cancelled')

  const tokens = await request(() =>
    publicApi.POST('/api/v1/auth/extension-token', {
      body: { code, redirect_uri: redirectUri },
    }),
  )
  if (!tokens.ok) return fail(tokens.error === 'signed-out' ? 'rejected' : tokens.error)

  await session.setTokens(tokens.data)
  await Promise.all([loadDisplayName(), listProfiles()])
  broadcast({ type: 'session:changed' })
  scheduler.soon()
  return ok(await sessionState())
}

async function signOut(): Promise<void> {
  const refreshToken = await session.refreshToken()
  // Revoking is best effort; the local session is cleared regardless.
  if (refreshToken) {
    await api
      .POST('/api/v1/auth/logout', { body: { refresh_token: refreshToken } })
      .catch(() => undefined)
  }
  // Parties belong to the account too; leave them while the token still works.
  await rooms.leaveAll()
  await session.clear()
  // Progress and the profile choice belong to the account that just left.
  await Promise.all([localStore.remove(['activeProfileId']), clearQueue()])
  broadcast({ type: 'session:changed' })
}

// ---------------------------------------------------------------------------
// Profiles

/** The stored profile if it still exists, else the first one. Persists the choice. */
export function pickActiveProfile(profiles: Profile[], stored: string | undefined): string | null {
  if (stored && profiles.some((p) => p.id === stored)) return stored
  return profiles[0]?.id ?? null
}

async function listProfiles(): Promise<
  Result<{ profiles: Profile[]; activeProfileId: string | null }>
> {
  if (!(await session.isSignedIn())) return fail('signed-out')
  const profiles = await request(() => api.GET('/api/v1/profiles'))
  if (!profiles.ok) return profiles
  const { activeProfileId: stored } = await localStore.get()
  const activeProfileId = pickActiveProfile(profiles.data, stored)
  if (activeProfileId !== stored) {
    if (activeProfileId) await localStore.set({ activeProfileId })
    else await localStore.remove(['activeProfileId'])
  }
  return ok({ profiles: profiles.data, activeProfileId })
}

async function setProfile(profileId: string): Promise<boolean> {
  const listed = await listProfiles()
  if (!listed.ok || !listed.data.profiles.some((p) => p.id === profileId)) return false
  await localStore.set({ activeProfileId: profileId })
  return true
}

/** The active profile id, picking the first profile when none is chosen yet. */
async function activeProfileId(): Promise<string | null> {
  const { activeProfileId: stored } = await localStore.get()
  if (stored) return stored
  const listed = await listProfiles()
  return listed.ok ? listed.data.activeProfileId : null
}

async function withProfile<T>(run: (profileId: string) => Promise<Result<T>>): Promise<Result<T>> {
  if (!(await session.isSignedIn())) return fail('signed-out')
  const profileId = await activeProfileId()
  if (!profileId) return fail('no-profile')
  return run(profileId)
}

// ---------------------------------------------------------------------------
// History, streaks, catalog

const continueWatching = () =>
  withProfile(async (profileId) => {
    const items = await request(() =>
      api.GET('/api/v1/history/continue-watching', {
        params: { query: { profile_id: profileId } },
      }),
    )
    return items.ok ? ok(items.data.slice(0, CONTINUE_WATCHING_LIMIT)) : items
  })

const streak = () =>
  withProfile((profileId) =>
    request(() =>
      api.GET('/api/v1/streaks/current', { params: { query: { profile_id: profileId } } }),
    ),
  )

async function show(showId: string) {
  if (!(await session.isSignedIn())) return fail('signed-out')
  return request(() =>
    api.GET('/api/v1/catalog/shows/{show_id}', { params: { path: { show_id: showId } } }),
  )
}

function fetchMatch(provider: string, snapshot: PlaybackSnapshot): Promise<Result<MatchResult>> {
  return request(() =>
    api.POST('/api/v1/catalog/match', {
      body: {
        provider,
        external_id: snapshot.externalId,
        show_title: snapshot.showTitle,
        episode_title: snapshot.episodeTitle,
        season: snapshot.season,
        episode: snapshot.episode,
        duration_seconds: snapshot.durationSeconds > 0 ? snapshot.durationSeconds : null,
      },
    }),
  )
}

function match(provider: string, snapshot: PlaybackSnapshot): Promise<Result<MatchResult>> {
  return cachedMatch(matchKey(provider, snapshot.externalId), () => fetchMatch(provider, snapshot))
}

/**
 * The match for what a tab is playing, for the countdown and the side panel. A cached
 * match without a next episode is re-checked, since the catalog grows as episodes are seen.
 */
async function currentEpisode(
  tabId: number,
  provider: string,
  snapshot: PlaybackSnapshot,
): Promise<Result<MatchResult>> {
  if (!(await session.isSignedIn())) return fail('signed-out')
  const found = await match(provider, snapshot)
  if (!found.ok) return found
  let result = found.data
  if (result.next_episode === null) {
    const next = await request(() =>
      api.GET('/api/v1/catalog/episodes/{episode_id}/next', {
        params: { path: { episode_id: result.episode_id } },
      }),
    )
    if (next.ok) {
      result = { ...result, next_episode: next.data }
      await writeCachedMatch(matchKey(provider, snapshot.externalId), result)
    }
  }
  await serialized(async () => {
    const { tabMatches = {} } = await sessionStore.get()
    await sessionStore.set({ tabMatches: { ...tabMatches, [String(tabId)]: result } })
  })
  broadcast({ type: 'episode:changed', tabId })
  return ok(result)
}

async function episodeForTab(tabId: number): Promise<MatchResult | null> {
  const { tabMatches = {} } = await sessionStore.get()
  return tabMatches[String(tabId)] ?? null
}

export function forgetTab(tabId: number): Promise<void> {
  return serialized(async () => {
    const { tabMatches = {} } = await sessionStore.get()
    if (!(String(tabId) in tabMatches)) return
    const { [String(tabId)]: _gone, ...rest } = tabMatches
    await sessionStore.set({ tabMatches: rest })
  })
}

// ---------------------------------------------------------------------------
// Progress sync

const flushDeps: FlushDeps = {
  isSignedIn: () => session.isSignedIn(),
  activeProfileId,
  match: (item) => match(item.adapter, item.snapshot),
  putProgress: (episodeId, profileId, positionSeconds, durationSeconds) =>
    request(() =>
      api.PUT('/api/v1/history/{episode_id}/progress', {
        params: { path: { episode_id: episodeId }, query: { profile_id: profileId } },
        body: { position_seconds: positionSeconds, duration_seconds: durationSeconds },
      }),
    ),
}

export const scheduler = createFlushScheduler(() => flush(flushDeps))

async function pushProgress(adapter: string, snapshot: PlaybackSnapshot): Promise<void> {
  const { activeProfileId: profileId } = await localStore.get()
  await push({ adapter, snapshot, queuedAt: Date.now(), profileId: profileId ?? null })
  scheduler.soon()
}

// ---------------------------------------------------------------------------
// Settings

async function getSettings(): Promise<Settings> {
  return normalizeSettings(await localStore.get())
}

async function setSettings(next: Partial<Settings>): Promise<Settings> {
  const settings = normalizeSettings({ ...(await getSettings()), ...next })
  await localStore.set(settings)
  return settings
}

// ---------------------------------------------------------------------------
// Watch parties

/** Refresh the access token when it has less than this long to live before opening a socket. */
const TOKEN_MIN_LIFE_MS = 60_000

/** A fresh access token for the party socket's auth frame, or null when signed out. */
async function partyToken(): Promise<string | null> {
  await session.load()
  if (!(await session.isSignedIn())) return null
  const { accessExpiresAt } = await sessionStore.get()
  if (
    !session.getAccessToken() ||
    accessExpiresAt === undefined ||
    accessExpiresAt - Date.now() < TOKEN_MIN_LIFE_MS
  ) {
    await session.refresh()
  }
  return session.getAccessToken()
}

const partyApi: PartyApi = {
  create: (body) => request(() => api.POST('/api/v1/parties', { body })),
  get: (code) => request(() => api.GET('/api/v1/parties/{code}', { params: { path: { code } } })),
  join: (code) =>
    request(() => api.POST('/api/v1/parties/{code}/join', { params: { path: { code } } }), {
      409: 'full',
    }),
  leave: (code) =>
    request(() => api.POST('/api/v1/parties/{code}/leave', { params: { path: { code } } })),
}

async function tabUrl(tabId: number): Promise<string | null> {
  try {
    return (await chrome.tabs.get(tabId)).url ?? null
  } catch {
    return null // the tab is gone
  }
}

export const rooms = createPartyRooms({
  api: partyApi,
  connect(code, handlers) {
    const connection = createPartyConnection({
      url: partySocketUrl(env.apiUrl, code),
      createSocket: webSocketFactory,
      getToken: partyToken,
      refreshToken: () => session.refresh(),
      ...handlers,
    })
    connection.connect()
    return connection
  },
  sendToTab,
  notifyChanged: (tabId) => broadcast({ type: 'party:changed', tabId }),
  tabUrl,
  episodeIdForTab: async (tabId) => (await episodeForTab(tabId))?.episode_id ?? null,
  load: async () => (await sessionStore.get()).tabParties ?? {},
  save: (tabParties) => serialized(() => sessionStore.set({ tabParties })),
})

async function startParty(tabId: number) {
  if (!(await session.isSignedIn())) return fail('signed-out')
  return rooms.start(tabId)
}

async function partyJoinRequest(tabId: number, url: string, code: string, confirm: boolean) {
  if (!(await session.isSignedIn())) return fail('signed-out')
  return rooms.joinRequest(tabId, url, code, confirm)
}

export const services: Services = {
  pushProgress,
  currentEpisode,
  sessionState,
  signIn,
  signOut,
  listProfiles,
  setProfile,
  continueWatching,
  streak,
  episodeForTab,
  show,
  getSettings,
  setSettings,
  startParty,
  leaveParty: (tabId) => rooms.leave(tabId),
  partyForTab: (tabId) => rooms.viewFor(tabId),
  partyJoinRequest,
  reportPartyAction: (tabId, action) => rooms.report(tabId, action),
}
