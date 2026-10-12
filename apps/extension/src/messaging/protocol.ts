import type { PlaybackSnapshot } from '../adapters/types'
import type { Result } from '../lib/result'
import type { ContinueWatchingItem, MatchResult, Profile, ShowDetail, Streak } from '../lib/types'
import type { ControlAction, MemberStatus, ReactionKind } from '../party/protocol'
import type { PartyLiveMessage, PartyTabMessage, PartyTabView } from '../party/rooms'

export type { PartyLiveMessage, PartyTabMessage, PartyTabView }

/**
 * Every message between contexts is one of these. The service worker answers; popup,
 * options, side panel and content script never call the API or touch tokens themselves.
 */
export type Message =
  // From the content script on a supported player.
  | { type: 'progress'; adapter: string; snapshot: PlaybackSnapshot }
  | { type: 'episode:current'; adapter: string; snapshot: PlaybackSnapshot }
  /** A play, pause or seek the viewer made on the player, for the tab's watch party. */
  | {
      type: 'party:report'
      adapter: string
      action: ControlAction
      position: number
      rate?: number
    }
  /**
   * An invite link opened this tab. `confirm: false` only looks the party up (to ask the
   * viewer); `confirm: true` is the viewer's click on Join.
   */
  | { type: 'party:join-request'; adapter: string; code: string; confirm: boolean }
  /** What the viewer is doing (watching, buffering, ad, away), for the member list. */
  | { type: 'party:status'; adapter: string; status: MemberStatus }
  /**
   * The pill's chat button: open the side panel for this tab. Handled synchronously by
   * the service worker so the click's user gesture still counts.
   */
  | { type: 'party:open-panel' }
  // From the content script (its own tab) or an extension page (any tab, by id).
  | { type: 'party:get-for-tab'; tabId?: number }
  | { type: 'party:react'; kind: ReactionKind; tabId?: number }
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
  | { type: 'party:start'; tabId: number }
  | { type: 'party:leave'; tabId: number }
  | { type: 'party:send-chat'; tabId: number; text: string }
  /** The Party tab is on screen for this tab. */
  | { type: 'party:mark-read'; tabId: number }

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
  'party:report': Ack
  'party:join-request': Result<PartyTabView>
  'party:get-for-tab': PartyTabView | null
  'party:start': Result<PartyTabView>
  'party:leave': Ack
  'party:status': Ack
  'party:open-panel': Ack
  'party:react': Ack
  'party:send-chat': Ack
  'party:mark-read': Ack
}

export type ReplyOf<T extends MessageType> = ReplyMap[T]
export type Reply<M extends Message> = ReplyMap[M['type']]
export type AnyReply = ReplyMap[MessageType]

export function send<M extends Message>(message: M): Promise<Reply<M>> {
  return chrome.runtime.sendMessage(message) as Promise<Reply<M>>
}

/** Fire-and-forget notices from the service worker to open extension pages. */
export type Broadcast =
  | { type: 'episode:changed'; tabId: number }
  | { type: 'session:changed' }
  | { type: 'party:changed'; tabId: number }
  /** A live room event for a tab (chat, presence, reactions, server errors, unread). */
  | (PartyLiveMessage & { tabId: number })

const PARTY_LIVE_TYPES = [
  'party:presence',
  'party:chat',
  'party:reaction',
  'party:error',
  'party:unread',
] as const satisfies readonly PartyLiveMessage['type'][]

const BROADCAST_TYPES = new Set<string>([
  'episode:changed',
  'session:changed',
  'party:changed',
  ...PARTY_LIVE_TYPES,
])

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

const PARTY_TAB_TYPES = new Set<string>([
  'party:state',
  'party:members',
  'party:ended',
  ...PARTY_LIVE_TYPES,
])

export function isPartyTabMessage(value: unknown): value is PartyTabMessage {
  return (
    typeof value === 'object' &&
    value !== null &&
    PARTY_TAB_TYPES.has((value as { type?: unknown }).type as string) &&
    typeof (value as { code?: unknown }).code === 'string'
  )
}

/** Service worker → one tab's content script. A tab without our content script is ignored. */
export function sendToTab(tabId: number, message: PartyTabMessage): void {
  chrome.tabs.sendMessage(tabId, message).catch(() => undefined)
}
