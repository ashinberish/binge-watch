import { createClockEstimator, type ClockEstimator } from './clock'
import {
  CloseCode,
  parseServerMessage,
  type ChatMessage,
  type ClientMessage,
  type ControlAction,
  type MemberStatus,
  type PartyMember,
  type PlaybackState,
  type Reaction,
  type ReactionKind,
  type RoomMember,
  type ServerMessage,
} from './protocol'

/** The subset of WebSocket the manager uses, so tests can pass a fake. */
export interface SocketLike {
  readonly readyState: number
  send(data: string): void
  close(code?: number, reason?: string): void
  onopen: ((event: unknown) => void) | null
  onmessage: ((event: { data: unknown }) => void) | null
  onclose: ((event: { code: number; reason?: string }) => void) | null
  onerror: ((event: unknown) => void) | null
}

const OPEN = 1

/** Wraps the browser's WebSocket in the SocketLike shape. */
export function webSocketFactory(url: string): SocketLike {
  const ws = new WebSocket(url)
  const socket: SocketLike = {
    get readyState() {
      return ws.readyState
    },
    send: (data) => ws.send(data),
    close: (code, reason) => ws.close(code, reason),
    onopen: null,
    onmessage: null,
    onclose: null,
    onerror: null,
  }
  ws.onopen = (event) => socket.onopen?.(event)
  ws.onmessage = (event) => socket.onmessage?.({ data: event.data })
  ws.onclose = (event) => socket.onclose?.({ code: event.code, reason: event.reason })
  ws.onerror = (event) => socket.onerror?.(event)
  return socket
}

/** Ping cadence. The server drops connections silent for 60 s, and MV3 keeps the worker alive while messages flow every < 30 s. */
export const PING_INTERVAL_MS = 20_000
/** No frame at all for this long (pongs included) means the connection is dead. */
export const SILENCE_LIMIT_MS = 45_000
/** Hold the welcome back this long at most while waiting for the first clock sample. */
export const CLOCK_WAIT_MS = 1_500

/** Reconnect delays: 1, 2, 4, 8 s, then every 15 s. */
export const BACKOFF_MS = [1_000, 2_000, 4_000, 8_000, 15_000] as const

export function backoffDelay(attempt: number): number {
  const index = Math.min(Math.max(0, Math.floor(attempt)), BACKOFF_MS.length - 1)
  return BACKOFF_MS[index] ?? 15_000
}

export type ConnectionStatus = 'connecting' | 'live' | 'reconnecting'

/** Why the connection stopped for good. `closed` is our own close() and is not reported. */
export type EndReason = 'ended' | 'unauthorized' | 'forbidden' | 'not-found'

/** What the welcome carries besides the playback state. */
export interface WelcomeExtras {
  /** Everyone in the room. Empty when the server does not send the list. */
  members: RoomMember[]
  /** Recent chat, oldest first. */
  chat: ChatMessage[]
}

export interface PartyConnectionDeps {
  url: string
  createSocket: (url: string) => SocketLike
  /** A usable access token (refreshed first if it is about to expire), or null when signed out. */
  getToken: () => Promise<string | null>
  /** Forces a refresh after the server rejected the token. True when a new token exists. */
  refreshToken: () => Promise<boolean>
  now?: () => number
  onWelcome?: (
    state: PlaybackState,
    members: number,
    you: PartyMember,
    extras: WelcomeExtras,
  ) => void
  onState?: (state: PlaybackState) => void
  onMembers?: (count: number) => void
  onPresence?: (members: RoomMember[]) => void
  onChat?: (message: ChatMessage) => void
  onReaction?: (reaction: Reaction) => void
  /** The server refused something we sent (e.g. chat too fast), as a sentence for people. */
  onError?: (detail: string) => void
  onStatus?: (status: ConnectionStatus) => void
  onEnd?: (reason: EndReason) => void
}

/**
 * One party's WebSocket: authenticates with the first frame, pings every 20 s, keeps a
 * clock-offset estimate from the pongs, and reconnects with backoff when the network
 * drops. A rejected token is refreshed and retried once.
 */
export function createPartyConnection(deps: PartyConnectionDeps) {
  const now = deps.now ?? Date.now
  const clock: ClockEstimator = createClockEstimator()

  let socket: SocketLike | null = null
  let stopped = false
  let attempt = 0
  let authRetried = false
  let welcomed = false
  let lastFrameAt = 0
  let pingTimer: ReturnType<typeof setInterval> | null = null
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  let clockTimer: ReturnType<typeof setTimeout> | null = null
  /** Pings in flight, oldest first, by local send time. */
  let pingsSent: number[] = []
  /** Frames held back with the welcome until the clock has a first sample. */
  let held: ServerMessage[] | null = null

  function clearTimers() {
    if (pingTimer !== null) clearInterval(pingTimer)
    if (reconnectTimer !== null) clearTimeout(reconnectTimer)
    if (clockTimer !== null) clearTimeout(clockTimer)
    pingTimer = reconnectTimer = clockTimer = null
  }

  function detach(target: SocketLike) {
    target.onopen = target.onmessage = target.onclose = target.onerror = null
  }

  function write(message: ClientMessage): boolean {
    if (!socket || socket.readyState !== OPEN) return false
    socket.send(JSON.stringify(message))
    return true
  }

  function ping() {
    if (write({ type: 'ping' })) pingsSent.push(now())
  }

  function end(reason: EndReason) {
    if (stopped) return
    stopped = true
    clearTimers()
    if (socket) {
      detach(socket)
      socket.close(CloseCode.normal)
      socket = null
    }
    deps.onEnd?.(reason)
  }

  function scheduleReconnect() {
    if (stopped) return
    clearTimers()
    deps.onStatus?.('reconnecting')
    const delay = backoffDelay(attempt)
    attempt += 1
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null
      void open()
    }, delay)
  }

  /** The connection went quiet or failed: drop it and try again later. */
  function drop() {
    if (socket) {
      detach(socket)
      socket.close(CloseCode.normal)
      socket = null
    }
    welcomed = false
    held = null
    scheduleReconnect()
  }

  function deliver(message: ServerMessage) {
    switch (message.type) {
      case 'welcome':
        deps.onStatus?.('live')
        deps.onWelcome?.(message.state, message.members, message.you, {
          members: message.members_list,
          chat: message.chat,
        })
        break
      case 'state':
        deps.onState?.(message.state)
        break
      case 'members':
        deps.onMembers?.(message.count)
        break
      case 'presence':
        deps.onPresence?.(message.members)
        break
      case 'chat':
        deps.onChat?.(message.message)
        break
      case 'reaction':
        deps.onReaction?.(message.reaction)
        break
      default:
        break
    }
  }

  function releaseHeld() {
    if (clockTimer !== null) clearTimeout(clockTimer)
    clockTimer = null
    const frames = held ?? []
    held = null
    for (const frame of frames) deliver(frame)
  }

  function onFrame(data: unknown) {
    lastFrameAt = now()
    const message = parseServerMessage(data)
    if (!message) return
    switch (message.type) {
      case 'pong': {
        const sentAt = pingsSent.shift()
        if (sentAt !== undefined) clock.sample(sentAt, now(), message.server_time)
        if (held) releaseHeld()
        return
      }
      case 'ended':
        end('ended')
        return
      case 'error':
        if (message.detail) deps.onError?.(message.detail)
        return
      case 'welcome':
        welcomed = true
        attempt = 0
        authRetried = false
        if (clock.ready()) {
          deliver(message)
        } else {
          held = [message]
          clockTimer = setTimeout(releaseHeld, CLOCK_WAIT_MS)
        }
        return
      default:
        if (held) held.push(message)
        else deliver(message)
    }
  }

  async function onClose(code: number) {
    if (stopped) return
    if (socket) detach(socket)
    socket = null
    welcomed = false
    held = null
    clearTimers()
    switch (code) {
      case CloseCode.badAuth:
        if (authRetried) return end('unauthorized')
        authRetried = true
        if (await deps.refreshToken()) {
          if (!stopped) void open()
          return
        }
        return end('unauthorized')
      case CloseCode.forbidden:
        return end('forbidden')
      case CloseCode.notFound:
        return end('not-found')
      case CloseCode.ended:
        return end('ended')
      default:
        scheduleReconnect()
    }
  }

  async function open() {
    if (stopped) return
    if (attempt === 0 && !welcomed) deps.onStatus?.('connecting')
    const token = await deps.getToken()
    if (stopped) return
    if (!token) return end('unauthorized')

    let next: SocketLike
    try {
      next = deps.createSocket(deps.url)
    } catch {
      scheduleReconnect()
      return
    }
    socket = next
    pingsSent = []
    next.onopen = () => {
      lastFrameAt = now()
      write({ type: 'auth', access_token: token })
      // An early ping gives the clock a sample before the welcome is applied.
      ping()
      pingTimer = setInterval(() => {
        if (now() - lastFrameAt > SILENCE_LIMIT_MS) {
          drop()
          return
        }
        ping()
      }, PING_INTERVAL_MS)
    }
    next.onmessage = (event) => onFrame(event.data)
    next.onclose = (event) => void onClose(event.code)
    next.onerror = () => undefined // a close event always follows
  }

  return {
    /** Opens the socket. Call once. */
    connect(): void {
      void open()
    },

    /** Sends a play/pause/seek. False when not connected (the action is dropped). */
    control(action: ControlAction, position: number, rate?: number): boolean {
      if (!welcomed) return false
      return write(
        rate === undefined
          ? { type: 'control', action, position }
          : { type: 'control', action, position, rate },
      )
    },

    /** Tells the room what this viewer is doing. False when not connected. */
    status(status: MemberStatus): boolean {
      if (!welcomed) return false
      return write({ type: 'status', status })
    },

    /** Sends a chat message. False when not connected (the message is not sent). */
    chat(text: string): boolean {
      if (!welcomed) return false
      return write({ type: 'chat', text })
    },

    /** Sends a reaction. False when not connected. */
    react(kind: ReactionKind): boolean {
      if (!welcomed) return false
      return write({ type: 'react', kind })
    },

    /** Closes for good without reporting an end. */
    close(): void {
      if (stopped) return
      stopped = true
      clearTimers()
      if (socket) {
        detach(socket)
        socket.close(CloseCode.normal)
        socket = null
      }
    },

    /** Server clock minus local clock, in ms. */
    clockOffsetMs: () => clock.offsetMs(),
    get connected() {
      return welcomed
    },
  }
}

export type PartyConnection = ReturnType<typeof createPartyConnection>
