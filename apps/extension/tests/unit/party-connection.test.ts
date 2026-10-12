import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  BACKOFF_MS,
  backoffDelay,
  CLOCK_WAIT_MS,
  createPartyConnection,
  PING_INTERVAL_MS,
  type PartyConnectionDeps,
  type SocketLike,
} from '../../src/party/connection'
import { playbackState } from './fixtures'

class FakeSocket implements SocketLike {
  readyState = 0
  sent: unknown[] = []
  closedWith: number | null = null
  onopen: SocketLike['onopen'] = null
  onmessage: SocketLike['onmessage'] = null
  onclose: SocketLike['onclose'] = null
  onerror: SocketLike['onerror'] = null

  constructor(readonly url: string) {}

  send(data: string) {
    this.sent.push(JSON.parse(data))
  }
  close(code?: number) {
    this.closedWith = code ?? 1000
    this.readyState = 3
  }

  // Server side
  open() {
    this.readyState = 1
    this.onopen?.({})
  }
  push(message: unknown) {
    this.onmessage?.({ data: JSON.stringify(message) })
  }
  serverClose(code: number) {
    this.readyState = 3
    this.onclose?.({ code })
  }
}

const you = { id: 'u1', display_name: 'Kai' }

function setup(overrides: Partial<PartyConnectionDeps> = {}) {
  const sockets: FakeSocket[] = []
  const deps = {
    url: 'ws://api.test/api/v1/parties/K7xQ2m/ws',
    createSocket: (url: string) => {
      const socket = new FakeSocket(url)
      sockets.push(socket)
      return socket
    },
    getToken: vi.fn(async () => 'token-1'),
    refreshToken: vi.fn(async () => true),
    onWelcome: vi.fn(),
    onState: vi.fn(),
    onMembers: vi.fn(),
    onStatus: vi.fn(),
    onEnd: vi.fn(),
    onPresence: vi.fn(),
    onChat: vi.fn(),
    onReaction: vi.fn(),
    onError: vi.fn(),
    ...overrides,
  }
  const connection = createPartyConnection(deps)
  const latest = () => {
    const socket = sockets.at(-1)
    if (!socket) throw new Error('no socket yet')
    return socket
  }
  return { deps, connection, sockets, latest }
}

/** Connects, opens, answers the first ping and welcomes. */
async function live(ctx: ReturnType<typeof setup>) {
  ctx.connection.connect()
  await vi.advanceTimersByTimeAsync(0)
  const socket = ctx.latest()
  socket.open()
  socket.push({ type: 'pong', server_time: Date.now() / 1000 })
  socket.push({ type: 'welcome', state: playbackState(), members: 2, you })
  return socket
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(1_000_000)
})
afterEach(() => {
  vi.useRealTimers()
})

describe('backoffDelay', () => {
  it('waits 1, 2, 4, 8, then 15 seconds between attempts', () => {
    expect([0, 1, 2, 3, 4, 5, 9].map(backoffDelay)).toEqual([
      1_000, 2_000, 4_000, 8_000, 15_000, 15_000, 15_000,
    ])
  })
})

describe('party connection', () => {
  it('authenticates with the first frame, then pings straight away', async () => {
    const ctx = setup()
    ctx.connection.connect()
    await vi.advanceTimersByTimeAsync(0)
    const socket = ctx.latest()
    expect(socket.url).toBe('ws://api.test/api/v1/parties/K7xQ2m/ws')
    expect(socket.sent).toEqual([])
    socket.open()
    expect(socket.sent).toEqual([{ type: 'auth', access_token: 'token-1' }, { type: 'ping' }])
    expect(ctx.deps.onStatus).toHaveBeenCalledWith('connecting')
  })

  it('pings every 20 seconds while connected', async () => {
    const ctx = setup()
    const socket = await live(ctx)
    const pings = () => socket.sent.filter((m) => (m as { type: string }).type === 'ping').length
    expect(pings()).toBe(1)
    await vi.advanceTimersByTimeAsync(PING_INTERVAL_MS - 1)
    expect(pings()).toBe(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(pings()).toBe(2)
    socket.push({ type: 'pong', server_time: Date.now() / 1000 })
    await vi.advanceTimersByTimeAsync(PING_INTERVAL_MS)
    expect(pings()).toBe(3)
  })

  it('holds the welcome until the first pong so the clock offset is known', async () => {
    const ctx = setup()
    ctx.connection.connect()
    await vi.advanceTimersByTimeAsync(0)
    const socket = ctx.latest()
    socket.open()
    socket.push({ type: 'welcome', state: playbackState(), members: 2, you })
    socket.push({ type: 'members', count: 3 })
    expect(ctx.deps.onWelcome).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(100)
    // The server clock is 5 s ahead; the pong comes back after 100 ms.
    socket.push({ type: 'pong', server_time: (Date.now() - 50) / 1000 + 5 })
    expect(ctx.deps.onWelcome).toHaveBeenCalledWith(playbackState(), 2, you, {
      members: [],
      chat: [],
    })
    expect(ctx.deps.onMembers).toHaveBeenCalledWith(3)
    expect(ctx.connection.clockOffsetMs()).toBe(5_000)
    expect(ctx.deps.onStatus).toHaveBeenLastCalledWith('live')
  })

  it('stops waiting for the clock after a moment', async () => {
    const ctx = setup()
    ctx.connection.connect()
    await vi.advanceTimersByTimeAsync(0)
    const socket = ctx.latest()
    socket.open()
    socket.push({ type: 'welcome', state: playbackState(), members: 1, you })
    await vi.advanceTimersByTimeAsync(CLOCK_WAIT_MS)
    expect(ctx.deps.onWelcome).toHaveBeenCalledOnce()
  })

  it('relays state and member counts, and sends controls once welcomed', async () => {
    const ctx = setup()
    ctx.connection.connect()
    await vi.advanceTimersByTimeAsync(0)
    expect(ctx.connection.control('play', 1)).toBe(false)
    const socket = ctx.latest()
    socket.open()
    socket.push({ type: 'pong', server_time: Date.now() / 1000 })
    socket.push({ type: 'welcome', state: playbackState(), members: 2, you })
    socket.push({ type: 'state', state: playbackState({ seq: 2, paused: true }) })
    socket.push({ type: 'members', count: 4 })
    socket.push({ type: 'error', detail: 'slow down' })
    socket.push({ nonsense: true })
    expect(ctx.deps.onState).toHaveBeenCalledWith(playbackState({ seq: 2, paused: true }))
    expect(ctx.deps.onMembers).toHaveBeenCalledWith(4)

    expect(ctx.connection.control('seek', 42.5, 1.25)).toBe(true)
    expect(ctx.connection.control('pause', 43)).toBe(true)
    expect(socket.sent.slice(-2)).toEqual([
      { type: 'control', action: 'seek', position: 42.5, rate: 1.25 },
      { type: 'control', action: 'pause', position: 43 },
    ])
  })

  it('reconnects with backoff after a network drop, re-authenticating with a fresh token', async () => {
    const ctx = setup()
    await live(ctx)
    const delays: number[] = []
    for (let i = 0; i < 6; i += 1) {
      const before = ctx.sockets.length
      ctx.latest().serverClose(1006)
      expect(ctx.deps.onStatus).toHaveBeenLastCalledWith('reconnecting')
      let waited = 0
      while (ctx.sockets.length === before) {
        await vi.advanceTimersByTimeAsync(500)
        waited += 500
      }
      delays.push(waited)
    }
    expect(delays).toEqual([...BACKOFF_MS, 15_000])
    expect(ctx.deps.getToken).toHaveBeenCalledTimes(7)

    // A welcome resets the schedule.
    const socket = ctx.latest()
    socket.open()
    expect(socket.sent[0]).toEqual({ type: 'auth', access_token: 'token-1' })
    socket.push({ type: 'pong', server_time: Date.now() / 1000 })
    socket.push({ type: 'welcome', state: playbackState(), members: 2, you })
    socket.serverClose(1006)
    await vi.advanceTimersByTimeAsync(1_000)
    expect(ctx.sockets).toHaveLength(8)
    expect(ctx.deps.onEnd).not.toHaveBeenCalled()
  })

  it.each([1006, 1011, 1012, 4408])('reconnects after close code %i', async (code) => {
    const ctx = setup()
    const socket = await live(ctx)
    socket.serverClose(code)
    await vi.advanceTimersByTimeAsync(BACKOFF_MS[0])
    expect(ctx.sockets).toHaveLength(2)
    expect(ctx.deps.onEnd).not.toHaveBeenCalled()
  })

  it('treats a connection that goes silent as dropped', async () => {
    const ctx = setup()
    const socket = await live(ctx)
    // No pongs come back any more.
    await vi.advanceTimersByTimeAsync(3 * PING_INTERVAL_MS)
    expect(socket.closedWith).toBe(1000)
    expect(ctx.deps.onStatus).toHaveBeenCalledWith('reconnecting')
    await vi.advanceTimersByTimeAsync(BACKOFF_MS[0])
    expect(ctx.sockets).toHaveLength(2)
  })

  it('refreshes the token once after 4401 and retries right away', async () => {
    const ctx = setup()
    ctx.connection.connect()
    await vi.advanceTimersByTimeAsync(0)
    ctx.latest().open()
    ctx.latest().serverClose(4401)
    await vi.advanceTimersByTimeAsync(0)
    expect(ctx.deps.refreshToken).toHaveBeenCalledOnce()
    expect(ctx.sockets).toHaveLength(2)

    ctx.latest().open()
    ctx.latest().serverClose(4401)
    await vi.advanceTimersByTimeAsync(0)
    expect(ctx.deps.refreshToken).toHaveBeenCalledOnce()
    expect(ctx.deps.onEnd).toHaveBeenCalledWith('unauthorized')
    await vi.advanceTimersByTimeAsync(60_000)
    expect(ctx.sockets).toHaveLength(2)
  })

  it('gives up on 4401 when the refresh fails, or when signed out', async () => {
    const refused = setup({ refreshToken: vi.fn(async () => false) })
    refused.connection.connect()
    await vi.advanceTimersByTimeAsync(0)
    refused.latest().open()
    refused.latest().serverClose(4401)
    await vi.advanceTimersByTimeAsync(0)
    expect(refused.deps.onEnd).toHaveBeenCalledWith('unauthorized')

    const signedOut = setup({ getToken: vi.fn(async () => null) })
    signedOut.connection.connect()
    await vi.advanceTimersByTimeAsync(0)
    expect(signedOut.sockets).toHaveLength(0)
    expect(signedOut.deps.onEnd).toHaveBeenCalledWith('unauthorized')
  })

  it.each([
    [4403, 'forbidden'],
    [4404, 'not-found'],
    [4410, 'ended'],
  ] as const)('stops for good on close code %i', async (code, reason) => {
    const ctx = setup()
    const socket = await live(ctx)
    socket.serverClose(code)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(ctx.deps.onEnd).toHaveBeenCalledWith(reason)
    expect(ctx.sockets).toHaveLength(1)
  })

  it('stops when the server says the party ended', async () => {
    const ctx = setup()
    const socket = await live(ctx)
    socket.push({ type: 'ended' })
    expect(ctx.deps.onEnd).toHaveBeenCalledWith('ended')
    expect(socket.closedWith).toBe(1000)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(ctx.sockets).toHaveLength(1)
  })

  it('closes quietly without reconnecting or reporting an end', async () => {
    const ctx = setup()
    const socket = await live(ctx)
    ctx.connection.close()
    expect(socket.closedWith).toBe(1000)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(ctx.sockets).toHaveLength(1)
    expect(ctx.deps.onEnd).not.toHaveBeenCalled()
    expect(socket.sent.filter((m) => (m as { type: string }).type === 'ping')).toHaveLength(1)
  })

  describe('chat, presence and reactions', () => {
    const sam = { id: 'u2', display_name: 'Sam' }
    const message = { id: 'm1', user: sam, text: 'hi', sent_at: 1_000 }

    it('passes the welcome’s member list and chat on', async () => {
      const ctx = setup()
      ctx.connection.connect()
      await vi.advanceTimersByTimeAsync(0)
      const socket = ctx.latest()
      socket.open()
      socket.push({ type: 'pong', server_time: Date.now() / 1000 })
      const members = [
        { id: 'u1', display_name: 'Kai', is_host: true, status: 'away', joined_at: 1 },
      ]
      socket.push({
        type: 'welcome',
        state: playbackState(),
        members: 1,
        you,
        members_list: members,
        chat: [message],
      })
      expect(ctx.deps.onWelcome).toHaveBeenCalledWith(playbackState(), 1, you, {
        members,
        chat: [message],
      })
    })

    it('relays presence, chat, reactions and server errors', async () => {
      const ctx = setup()
      const socket = await live(ctx)
      socket.push({ type: 'presence', members: [] })
      socket.push({ type: 'chat', message })
      socket.push({ type: 'reaction', id: 'r1', kind: 'clap', user: sam, at: 1 })
      socket.push({ type: 'error', detail: "You're sending messages too quickly." })
      expect(ctx.deps.onPresence).toHaveBeenCalledWith([])
      expect(ctx.deps.onChat).toHaveBeenCalledWith(message)
      expect(ctx.deps.onReaction).toHaveBeenCalledWith({ id: 'r1', kind: 'clap', user: sam, at: 1 })
      expect(ctx.deps.onError).toHaveBeenCalledWith("You're sending messages too quickly.")
    })

    it('sends status, chat and reactions only once welcomed', async () => {
      const ctx = setup()
      ctx.connection.connect()
      await vi.advanceTimersByTimeAsync(0)
      expect(ctx.connection.chat('early')).toBe(false)
      expect(ctx.connection.status('away')).toBe(false)
      expect(ctx.connection.react('heart')).toBe(false)
      ctx.latest().open()
      const socket = ctx.latest()
      socket.push({ type: 'pong', server_time: Date.now() / 1000 })
      socket.push({ type: 'welcome', state: playbackState(), members: 2, you })
      expect(ctx.connection.status('buffering')).toBe(true)
      expect(ctx.connection.chat('that ending')).toBe(true)
      expect(ctx.connection.react('sad')).toBe(true)
      expect(socket.sent.slice(-3)).toEqual([
        { type: 'status', status: 'buffering' },
        { type: 'chat', text: 'that ending' },
        { type: 'react', kind: 'sad' },
      ])
    })
  })
})
