import { describe, expect, it, vi } from 'vitest'

import { fail, ok } from '../../src/lib/result'
import type { PartyConnection } from '../../src/party/connection'
import {
  createPartyRooms,
  type ConnectionHandlers,
  type PartyInfo,
  type StoredParty,
} from '../../src/party/rooms'
import { playbackState } from './fixtures'

const WATCH = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'

const party = (overrides: Partial<PartyInfo> = {}): PartyInfo => ({
  code: 'K7xQ2m',
  invite_url: 'http://web.test/party/K7xQ2m',
  provider: 'youtube',
  watch_url: WATCH,
  host: { display_name: 'Kai' },
  member_count: 1,
  ...overrides,
})

function setup(tabs: Record<number, string> = { 7: `${WATCH}&t=42s` }) {
  const connections: Array<{
    code: string
    handlers: ConnectionHandlers
    connection: PartyConnection & { close: ReturnType<typeof vi.fn> }
  }> = []
  let saved: Record<string, StoredParty> = {}
  const deps = {
    api: {
      create: vi.fn(async () => ok(party())),
      get: vi.fn(async () => ok(party({ member_count: 2 }))),
      join: vi.fn(async () => ok(party({ member_count: 3 }))),
      leave: vi.fn(async () => ok(undefined)),
    },
    connect: vi.fn((code: string, handlers: ConnectionHandlers) => {
      const connection = {
        connect: vi.fn(),
        control: vi.fn(() => true),
        close: vi.fn(),
        clockOffsetMs: () => 250,
        connected: true,
      }
      connections.push({ code, handlers, connection })
      return connection
    }),
    sendToTab: vi.fn(),
    notifyChanged: vi.fn(),
    tabUrl: vi.fn(async (tabId: number) => tabs[tabId] ?? null),
    episodeIdForTab: vi.fn(async () => 'e1'),
    load: vi.fn(async () => saved),
    save: vi.fn(async (next: Record<string, StoredParty>) => {
      saved = next
    }),
  }
  const rooms = createPartyRooms(deps)
  return { deps, rooms, connections, saved: () => saved, seed: (s: typeof saved) => (saved = s) }
}

describe('party rooms', () => {
  it('starts a party for the tab’s canonical watch URL and connects', async () => {
    const { rooms, deps, connections, saved } = setup()
    const result = await rooms.start(7)
    expect(deps.api.create).toHaveBeenCalledWith({
      provider: 'youtube',
      watch_url: WATCH,
      episode_id: 'e1',
    })
    expect(result).toMatchObject({
      ok: true,
      data: { code: 'K7xQ2m', inviteUrl: 'http://web.test/party/K7xQ2m', status: 'connecting' },
    })
    expect(connections).toHaveLength(1)
    expect(saved()).toEqual({ '7': expect.objectContaining({ code: 'K7xQ2m', watchUrl: WATCH }) })
    expect(deps.notifyChanged).toHaveBeenCalledWith(7)
  })

  it('refuses to start on a page without a player', async () => {
    const { rooms, deps } = setup({ 7: 'https://www.youtube.com/' })
    expect(await rooms.start(7)).toEqual(fail('rejected'))
    expect(deps.api.create).not.toHaveBeenCalled()
  })

  it('relays the welcome, states and member counts to the tab', async () => {
    const { rooms, deps, connections } = setup()
    await rooms.start(7)
    const { handlers } = connections[0]!
    handlers.onWelcome(playbackState(), 2, { id: 'u', display_name: 'Kai' })
    handlers.onState(playbackState({ seq: 2 }))
    handlers.onMembers(3)
    expect(deps.sendToTab.mock.calls).toEqual([
      [7, { type: 'party:state', code: 'K7xQ2m', state: playbackState(), clockOffsetMs: 250 }],
      [7, { type: 'party:members', code: 'K7xQ2m', count: 2 }],
      [
        7,
        {
          type: 'party:state',
          code: 'K7xQ2m',
          state: playbackState({ seq: 2 }),
          clockOffsetMs: 250,
        },
      ],
      [7, { type: 'party:members', code: 'K7xQ2m', count: 3 }],
    ])
    expect(await rooms.viewFor(7)).toMatchObject({
      status: 'live',
      memberCount: 3,
      state: playbackState({ seq: 2 }),
    })
  })

  it('sends reported actions to the tab’s connection', async () => {
    const { rooms, connections } = setup()
    expect(await rooms.report(7, { action: 'play', position: 3, rate: 1 })).toBe(false)
    await rooms.start(7)
    expect(await rooms.report(7, { action: 'seek', position: 30, rate: 1.5 })).toBe(true)
    expect(connections[0]!.connection.control).toHaveBeenCalledWith('seek', 30, 1.5)
  })

  it('previews an invite without joining, then joins on confirm', async () => {
    const { rooms, deps, connections } = setup()
    const preview = await rooms.joinRequest(7, `${WATCH}&t=1`, 'K7xQ2m', false)
    expect(preview).toMatchObject({ ok: true, data: { status: 'invited', hostName: 'Kai' } })
    expect(deps.api.join).not.toHaveBeenCalled()
    expect(connections).toHaveLength(0)

    const joined = await rooms.joinRequest(7, WATCH, 'K7xQ2m', true)
    expect(joined).toMatchObject({ ok: true, data: { status: 'connecting', memberCount: 3 } })
    expect(deps.api.join).toHaveBeenCalledWith('K7xQ2m')
    expect(connections).toHaveLength(1)
  })

  it('refuses an invite for a different video, and passes API failures on', async () => {
    const { rooms, deps } = setup()
    expect(
      await rooms.joinRequest(7, 'https://www.youtube.com/watch?v=other123', 'K7xQ2m', false),
    ).toEqual(fail('rejected'))
    deps.api.join.mockResolvedValueOnce(fail('full'))
    expect(await rooms.joinRequest(7, WATCH, 'K7xQ2m', true)).toEqual(fail('full'))
  })

  it('leaves on request: closes the socket, tells the API and the tab', async () => {
    const { rooms, deps, connections, saved } = setup()
    await rooms.start(7)
    await rooms.leave(7)
    expect(connections[0]!.connection.close).toHaveBeenCalled()
    expect(deps.api.leave).toHaveBeenCalledWith('K7xQ2m')
    expect(deps.sendToTab).toHaveBeenCalledWith(7, {
      type: 'party:ended',
      code: 'K7xQ2m',
      reason: 'left',
    })
    expect(saved()).toEqual({})
    expect(await rooms.viewFor(7)).toBeNull()
  })

  it('leaves when the tab moves to another video or closes, not on the same video', async () => {
    const { rooms, deps } = setup({ 7: WATCH, 8: WATCH })
    await rooms.start(7)
    await rooms.start(8)
    await rooms.tabUrlChanged(7, `${WATCH}&t=99`)
    expect(deps.api.leave).not.toHaveBeenCalled()
    await rooms.tabUrlChanged(7, 'https://www.youtube.com/watch?v=other123')
    expect(deps.api.leave).toHaveBeenCalledTimes(1)
    await rooms.tabClosed(8)
    expect(deps.api.leave).toHaveBeenCalledTimes(2)
    expect(deps.sendToTab).not.toHaveBeenCalledWith(8, expect.anything())
  })

  it('forgets a party the server ended and tells the tab', async () => {
    const { rooms, deps, connections } = setup()
    await rooms.start(7)
    connections[0]!.handlers.onEnd('ended')
    expect(deps.sendToTab).toHaveBeenCalledWith(7, {
      type: 'party:ended',
      code: 'K7xQ2m',
      reason: 'ended',
    })
    expect(await rooms.viewFor(7)).toBeNull()
    expect(deps.api.leave).not.toHaveBeenCalled()
  })

  it('ignores events from a connection that was replaced', async () => {
    const { rooms, deps, connections } = setup()
    await rooms.start(7)
    await rooms.start(7)
    deps.sendToTab.mockClear()
    connections[0]!.handlers.onMembers(9)
    connections[0]!.handlers.onEnd('ended')
    expect(deps.sendToTab).not.toHaveBeenCalled()
    expect(await rooms.viewFor(7)).not.toBeNull()
  })

  it('reconnects stored parties after a worker restart, if the tab is still on the video', async () => {
    const stored: StoredParty = {
      code: 'K7xQ2m',
      inviteUrl: 'http://web.test/party/K7xQ2m',
      hostName: 'Kai',
      provider: 'youtube',
      watchUrl: WATCH,
    }
    const ctx = setup({ 7: WATCH, 8: 'https://www.youtube.com/watch?v=other123' })
    ctx.seed({ '7': stored, '8': stored, '9': stored })
    await ctx.rooms.restore()
    expect(ctx.connections.map((c) => c.code)).toEqual(['K7xQ2m'])
    expect(await ctx.rooms.viewFor(7)).toMatchObject({ code: 'K7xQ2m' })
    expect(ctx.saved()).toEqual({ '7': stored })
  })
})
