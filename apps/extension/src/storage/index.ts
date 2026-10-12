import type { PlaybackSnapshot } from '../adapters/types'
import type { MatchResult } from '../lib/types'

/**
 * Typed wrappers over chrome.storage. The service worker can be killed at any
 * moment, so every piece of state it needs lives here, not in memory.
 *
 * Tokens: the access token lives in storage.session (memory-backed, cleared when the
 * browser closes, not readable by content scripts). The refresh token lives in
 * storage.local so a browser restart does not sign the viewer out. Only the service
 * worker reads or writes either of them.
 */
export interface SessionArea {
  accessToken?: string
  /** Epoch ms when the access token expires. */
  accessExpiresAt?: number
  /** Latest catalog match per tab, for the side panel. Keyed by tab id. */
  tabMatches?: Record<string, MatchResult>
}

export interface LocalArea {
  refreshToken?: string
  displayName?: string
  activeProfileId?: string
  syncQueue?: QueuedProgress[]
  countdownSeconds?: number
  /** Most recently used last. See src/sync/match-cache.ts. */
  matchCache?: MatchCacheEntry[]
}

export interface QueuedProgress {
  adapter: string
  snapshot: PlaybackSnapshot
  queuedAt: number
  /** Profile that was active when the snapshot was taken, if any. */
  profileId?: string | null
}

export type MatchCacheEntry = [key: string, value: MatchResult]

async function getArea<T extends object>(area: chrome.storage.StorageArea): Promise<Partial<T>> {
  return (await area.get(null)) as Partial<T>
}

function makeStore<T extends object>(area: () => chrome.storage.StorageArea) {
  return {
    get: () => getArea<T>(area()),
    set: (value: Partial<T>) => area().set(value),
    remove: (keys: Array<keyof T & string>) => area().remove(keys),
  }
}

export const sessionStore = makeStore<SessionArea>(() => chrome.storage.session)
export const localStore = makeStore<LocalArea>(() => chrome.storage.local)

let chain: Promise<unknown> = Promise.resolve()

/**
 * Runs read-modify-write sequences on storage one at a time, so a snapshot pushed
 * while the queue is flushing (or a cache write racing another) is never lost.
 */
export function serialized<T>(task: () => Promise<T>): Promise<T> {
  const run = chain.then(task, task)
  chain = run.catch(() => undefined)
  return run
}
