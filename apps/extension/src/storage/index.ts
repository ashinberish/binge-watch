import type { PlaybackSnapshot } from '../adapters/types'

/**
 * Typed wrappers over chrome.storage. The service worker can be killed at any
 * moment, so every piece of state it needs lives here, not in memory.
 */
interface SessionArea {
  accessToken?: string
  refreshToken?: string
  displayName?: string
}

interface LocalArea {
  activeProfileId?: string
  syncQueue?: QueuedProgress[]
  countdownSeconds?: number
}

export interface QueuedProgress {
  adapter: string
  snapshot: PlaybackSnapshot
  queuedAt: number
}

async function getArea<T extends object>(area: chrome.storage.StorageArea): Promise<Partial<T>> {
  return (await area.get(null)) as Partial<T>
}

export const sessionStore = {
  get: () => getArea<SessionArea>(chrome.storage.session),
  set: (value: SessionArea) => chrome.storage.session.set(value),
  clear: () => chrome.storage.session.clear(),
}

export const localStore = {
  get: () => getArea<LocalArea>(chrome.storage.local),
  set: (value: LocalArea) => chrome.storage.local.set(value),
}
