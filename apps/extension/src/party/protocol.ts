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

// Server → client
export type ServerMessage =
  | { type: 'welcome'; state: PlaybackState; members: number; you: PartyMember }
  | { type: 'state'; state: PlaybackState }
  | { type: 'members'; count: number }
  | { type: 'pong'; server_time: number }
  | { type: 'ended' }
  | { type: 'error'; detail: string }

// Client → server
export type ClientMessage =
  | { type: 'auth'; access_token: string }
  | { type: 'control'; action: ControlAction; position: number; rate?: number }
  | { type: 'ping' }

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
            you: value.you,
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
    default:
      return null
  }
}

/** `http(s)://host` → `ws(s)://host/api/v1/parties/{code}/ws`. */
export function partySocketUrl(apiUrl: string, code: string): string {
  const base = apiUrl.replace(/\/+$/, '').replace(/^http(s?):\/\//i, 'ws$1://')
  return `${base}/api/v1/parties/${encodeURIComponent(code)}/ws`
}
