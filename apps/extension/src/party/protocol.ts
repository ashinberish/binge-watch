/**
 * Wire format of the watch-party WebSocket (`/api/v1/parties/{code}/ws`). The HTTP
 * endpoints are typed by the generated API client; this socket is not in the OpenAPI
 * schema, so its frames are typed and validated here.
 */

export interface PartyMember {
  id: string
  display_name: string
}

/** The room's playback, as last set by any member. The server orders actions with `seq`. */
export interface PlaybackState {
  paused: boolean
  /** Seconds into the video at `updated_at`. */
  position: number
  rate: number
  /** Server epoch seconds when this state was set. */
  updated_at: number
  seq: number
  by: PartyMember | null
}

export type ControlAction = 'play' | 'pause' | 'seek'

/** What a member is doing right now, as their content script reports it. */
export type MemberStatus = 'watching' | 'buffering' | 'ad' | 'away'

export const MEMBER_STATUSES: readonly MemberStatus[] = ['watching', 'buffering', 'ad', 'away']

/** One person in the room, from the welcome's `members_list` and `presence` frames. */
export interface RoomMember {
  id: string
  display_name: string
  is_host: boolean
  status: MemberStatus
  /** Server epoch seconds. */
  joined_at: number
}

export interface ChatMessage {
  id: string
  user: PartyMember
  text: string
  /** Server epoch seconds. */
  sent_at: number
}

export type ReactionKind = 'heart' | 'laugh' | 'wow' | 'fire' | 'clap' | 'sad'

export const REACTION_KINDS: readonly ReactionKind[] = [
  'heart',
  'laugh',
  'wow',
  'fire',
  'clap',
  'sad',
]

export interface Reaction {
  id: string
  kind: ReactionKind
  user: PartyMember
  /** Server epoch seconds. */
  at: number
}

/** The server accepts 1–500 characters per chat message (after cleaning). */
export const CHAT_MAX_LENGTH = 500
/** The server keeps (and sends in the welcome) this many recent messages. */
export const CHAT_HISTORY_LIMIT = 50

// Server → client
export type ServerMessage =
  | {
      type: 'welcome'
      state: PlaybackState
      members: number
      you: PartyMember
      /** Empty when the server does not send them. */
      members_list: RoomMember[]
      chat: ChatMessage[]
    }
  | { type: 'state'; state: PlaybackState }
  | { type: 'members'; count: number }
  | { type: 'pong'; server_time: number }
  | { type: 'ended' }
  | { type: 'error'; detail: string }
  | { type: 'presence'; members: RoomMember[] }
  | { type: 'chat'; message: ChatMessage }
  | { type: 'reaction'; reaction: Reaction }

// Client → server
export type ClientMessage =
  | { type: 'auth'; access_token: string }
  | { type: 'control'; action: ControlAction; position: number; rate?: number }
  | { type: 'ping' }
  | { type: 'status'; status: MemberStatus }
  | { type: 'chat'; text: string }
  | { type: 'react'; kind: ReactionKind }

/** Close codes the server uses on top of the standard ones. */
export const CloseCode = {
  normal: 1000,
  badAuth: 4401,
  forbidden: 4403,
  notFound: 4404,
  ended: 4410,
} as const

const CONTROL_ACTIONS = new Set<string>(['play', 'pause', 'seek'])

export function isControlAction(value: unknown): value is ControlAction {
  return typeof value === 'string' && CONTROL_ACTIONS.has(value)
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value)

function isMember(value: unknown): value is PartyMember {
  return isRecord(value) && typeof value.id === 'string' && typeof value.display_name === 'string'
}

const MEMBER_STATUS_SET = new Set<string>(MEMBER_STATUSES)
const REACTION_KIND_SET = new Set<string>(REACTION_KINDS)

export function isMemberStatus(value: unknown): value is MemberStatus {
  return typeof value === 'string' && MEMBER_STATUS_SET.has(value)
}

export function isReactionKind(value: unknown): value is ReactionKind {
  return typeof value === 'string' && REACTION_KIND_SET.has(value)
}

/**
 * A server timestamp as epoch seconds. Accepts epoch seconds or an ISO 8601 string,
 * since JSON-dumped datetimes arrive as strings. Null when it is neither.
 */
export function toEpochSeconds(value: unknown): number | null {
  if (isFiniteNumber(value)) return value
  if (typeof value === 'string' && value) {
    const ms = Date.parse(value)
    return Number.isFinite(ms) ? ms / 1000 : null
  }
  return null
}

const userOf = (value: PartyMember): PartyMember => ({
  id: value.id,
  display_name: value.display_name,
})

/** One member of a presence list. An unknown status reads as watching. */
export function parseRoomMember(value: unknown): RoomMember | null {
  if (!isMember(value)) return null
  const record = value as unknown as Record<string, unknown>
  return {
    id: value.id,
    display_name: value.display_name,
    is_host: record.is_host === true,
    status: isMemberStatus(record.status) ? record.status : 'watching',
    joined_at: toEpochSeconds(record.joined_at) ?? 0,
  }
}

export function parseChatMessage(value: unknown): ChatMessage | null {
  if (!isRecord(value) || typeof value.id !== 'string' || !value.id) return null
  if (!isMember(value.user) || typeof value.text !== 'string') return null
  const sentAt = toEpochSeconds(value.sent_at)
  if (sentAt === null) return null
  return { id: value.id, user: userOf(value.user), text: value.text, sent_at: sentAt }
}

/** Members (or messages) of a list; malformed entries are skipped. Not a list → null. */
function parseList<T>(value: unknown, parse: (item: unknown) => T | null): T[] | null {
  if (!Array.isArray(value)) return null
  const out: T[] = []
  for (const item of value) {
    const parsed = parse(item)
    if (parsed) out.push(parsed)
  }
  return out
}

export function isPlaybackState(value: unknown): value is PlaybackState {
  return (
    isRecord(value) &&
    typeof value.paused === 'boolean' &&
    isFiniteNumber(value.position) &&
    isFiniteNumber(value.rate) &&
    value.rate > 0 &&
    isFiniteNumber(value.updated_at) &&
    isFiniteNumber(value.seq) &&
    (value.by === null || value.by === undefined || isMember(value.by))
  )
}

/** Parses one text frame from the server. Anything malformed or unknown is null. */
export function parseServerMessage(data: unknown): ServerMessage | null {
  if (typeof data !== 'string') return null
  let value: unknown
  try {
    value = JSON.parse(data)
  } catch {
    return null
  }
  if (!isRecord(value)) return null
  switch (value.type) {
    case 'welcome':
      return isPlaybackState(value.state) && isFiniteNumber(value.members) && isMember(value.you)
        ? {
            type: 'welcome',
            state: { ...value.state, by: value.state.by ?? null },
            members: value.members,
            you: userOf(value.you),
            members_list: parseList(value.members_list, parseRoomMember) ?? [],
            chat: (parseList(value.chat, parseChatMessage) ?? []).slice(-CHAT_HISTORY_LIMIT),
          }
        : null
    case 'state':
      return isPlaybackState(value.state)
        ? { type: 'state', state: { ...value.state, by: value.state.by ?? null } }
        : null
    case 'members':
      return isFiniteNumber(value.count) ? { type: 'members', count: value.count } : null
    case 'pong':
      return isFiniteNumber(value.server_time)
        ? { type: 'pong', server_time: value.server_time }
        : null
    case 'ended':
      return { type: 'ended' }
    case 'error':
      return { type: 'error', detail: typeof value.detail === 'string' ? value.detail : '' }
    case 'presence': {
      const members = parseList(value.members, parseRoomMember)
      return members ? { type: 'presence', members } : null
    }
    case 'chat': {
      const message = parseChatMessage(value.message)
      return message ? { type: 'chat', message } : null
    }
    case 'reaction': {
      const at = toEpochSeconds(value.at)
      if (typeof value.id !== 'string' || !isReactionKind(value.kind) || !isMember(value.user)) {
        return null
      }
      return {
        type: 'reaction',
        reaction: { id: value.id, kind: value.kind, user: userOf(value.user), at: at ?? 0 },
      }
    }
    default:
      return null
  }
}

/** `http(s)://host` → `ws(s)://host/api/v1/parties/{code}/ws`. */
export function partySocketUrl(apiUrl: string, code: string): string {
  const base = apiUrl.replace(/\/+$/, '').replace(/^http(s?):\/\//i, 'ws$1://')
  return `${base}/api/v1/parties/${encodeURIComponent(code)}/ws`
}
