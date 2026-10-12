import type { PlaybackSnapshot } from '../adapters/types'
import type { Result } from '../lib/result'
import type { ContinueWatchingItem, MatchResult, Profile, ShowDetail, Streak } from '../lib/types'

/**
 * Every message between contexts is one of these. The service worker answers; popup,
 * options, side panel and content script never call the API or touch tokens themselves.
 */
export type Message =
  // From the content script on a supported player.
  | { type: 'progress'; adapter: string; snapshot: PlaybackSnapshot }
  | { type: 'episode:current'; adapter: string; snapshot: PlaybackSnapshot }
  // From extension pages (popup, options, side panel).
  | { type: 'session:get' }
  | { type: 'session:sign-in' }
  | { type: 'session:sign-out' }
  | { type: 'profiles:list' }
  | { type: 'profile:set'; profileId: string }
  | { type: 'history:continue' }
  | { type: 'streak:get' }
  | { type: 'episode:for-tab'; tabId: number }
  | { type: 'show:get'; showId: string }
  | { type: 'settings:get' }
  | { type: 'settings:set'; settings: Partial<Settings> }

export type MessageType = Message['type']

export interface SessionState {
  signedIn: boolean
  displayName: string | null
}

export interface ProfilesState {
  profiles: Profile[]
  activeProfileId: string | null
}

export interface Settings {
  /** Length of the next-episode countdown, 5–30 seconds. */
  countdownSeconds: number
}

export interface Ack {
  ok: boolean
}

interface ReplyMap {
  progress: Ack
  'episode:current': Result<MatchResult>
  'session:get': SessionState
  'session:sign-in': Result<SessionState>
  'session:sign-out': Ack
  'profiles:list': Result<ProfilesState>
  'profile:set': Ack
  'history:continue': Result<ContinueWatchingItem[]>
  'streak:get': Result<Streak>
  'episode:for-tab': MatchResult | null
  'show:get': Result<ShowDetail>
  'settings:get': Settings
  'settings:set': Settings
}

export type ReplyOf<T extends MessageType> = ReplyMap[T]
export type Reply<M extends Message> = ReplyMap[M['type']]
export type AnyReply = ReplyMap[MessageType]

export function send<M extends Message>(message: M): Promise<Reply<M>> {
  return chrome.runtime.sendMessage(message) as Promise<Reply<M>>
}

/** Fire-and-forget notices from the service worker to open extension pages. */
export type Broadcast = { type: 'episode:changed'; tabId: number } | { type: 'session:changed' }

const BROADCAST_TYPES = new Set<string>(['episode:changed', 'session:changed'])

export function isBroadcast(value: unknown): value is Broadcast {
  return (
    typeof value === 'object' &&
    value !== null &&
    BROADCAST_TYPES.has((value as { type?: unknown }).type as string)
  )
}

export function broadcast(message: Broadcast): void {
  // Rejects with "Receiving end does not exist" when no extension page is open. That is fine.
  chrome.runtime.sendMessage(message).catch(() => undefined)
}

/** Subscribe to broadcasts in an extension page. Returns the unsubscribe function. */
export function onBroadcast(listener: (message: Broadcast) => void): () => void {
  const handler = (message: unknown) => {
    if (isBroadcast(message)) listener(message)
  }
  chrome.runtime.onMessage.addListener(handler)
  return () => chrome.runtime.onMessage.removeListener(handler)
}
