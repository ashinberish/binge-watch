import { describe, expect, it, vi } from 'vitest'

import type { PlayerAdapter } from '../../src/adapters/types'
import {
  createPartyOverlay,
  ENDED_NOTICE_MS,
  membersLabel,
  type PartyOverlayView,
} from '../../src/features/party/overlay'
import { inviteQuestion } from '../../src/features/party/PartyOverlay'
import { fail, ok } from '../../src/lib/result'
import type { Message, PartyTabView } from '../../src/messaging/protocol'
import { playbackState } from './fixtures'

const WATCH = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'

const view = (overrides: Partial<PartyTabView> = {}): PartyTabView => ({
  code: 'K7xQ2m',
  inviteUrl: 'http://web.test/party/K7xQ2m',
  hostName: 'Kai',
  provider: 'youtube',
  watchUrl: WATCH,
  memberCount: 3,
  status: 'live',
  state: null,
  clockOffsetMs: 0,
  ...overrides,
})

function setup(href = `${WATCH}#nightreel-party=K7xQ2m`) {
  const page = { href, ad: false, now: 1_005_000 }
  const video = {
    paused: true,
    currentTime: 0,
    playbackRate: 1,
    play: vi.fn(async () => undefined),
    pause: vi.fn(),
    getBoundingClientRect: () => ({ top: 56, right: 1000, width: 960, height: 540 }),
  }
  const doc = {
    get location() {
      return { href: page.href }
    },
    documentElement: { clientWidth: 1200 },
  } as unknown as Document
  const adapter = {
    id: 'youtube',
    findVideo: () => video,
    isAd: () => page.ad,
  } as unknown as PlayerAdapter
  const replies: Partial<Record<Message['type'], unknown>> = {
    'party:get-for-tab': null,
    'party:join-request': ok(view({ status: 'invited' })),
  }
  const send = vi.fn(async (message: Message) => {
    if (message.type === 'party:join-request' && message.confirm) {
      return ok(view({ status: 'connecting' }))
    }
    return replies[message.type]
  })
  const views: Array<PartyOverlayView | null> = []
  const replaceUrl = vi.fn((url: string) => {
    page.href = url
  })
  const overlay = createPartyOverlay({
    adapter,
    doc,
    send: send as never,
    render: (v) => views.push(v),
    replaceUrl,
    now: () => page.now,
  })
  return { page, video, send, views, replaceUrl, replies, overlay, last: () => views.at(-1) }
}

describe('party overlay', () => {
  it('strips the invite from the URL and asks before joining', async () => {
    const ctx = setup()
    await ctx.overlay.start()
    expect(ctx.replaceUrl).toHaveBeenCalledWith(WATCH)
    expect(ctx.send).toHaveBeenCalledWith({
      type: 'party:join-request',
      adapter: 'youtube',
      code: 'K7xQ2m',
      confirm: false,
    })
    await vi.waitFor(() =>
      expect(ctx.last()).toEqual({ kind: 'invite', hostName: 'Kai', joining: false, error: null }),
    )
    expect(inviteQuestion('Kai')).toBe("Join Kai's watch party?")
    // Never joins without the click.
    expect(ctx.send).not.toHaveBeenCalledWith(expect.objectContaining({ confirm: true }))
  })

  it('joins on the click and shows the pill', async () => {
    const ctx = setup()
    await ctx.overlay.start()
    await vi.waitFor(() => expect(ctx.last()?.kind).toBe('invite'))
    await ctx.overlay.join()
    expect(ctx.send).toHaveBeenCalledWith(expect.objectContaining({ confirm: true }))
    expect(ctx.last()).toEqual({
      kind: 'pill',
      label: 'Watch party · 3 watching',
      needsClick: false,
      anchor: { top: 68, right: 212 },
    })
    expect(ctx.overlay.inParty).toBe(true)
  })

  it('goes away on "Not now"', async () => {
    const ctx = setup()
    await ctx.overlay.start()
    await vi.waitFor(() => expect(ctx.last()?.kind).toBe('invite'))
    ctx.overlay.dismiss()
    expect(ctx.last()).toBeNull()
    expect(ctx.overlay.inParty).toBe(false)
  })

  it('explains an invite that cannot be used', async () => {
    const ctx = setup()
    ctx.replies['party:join-request'] = fail('not-found')
    await ctx.overlay.start()
    await vi.waitFor(() =>
      expect(ctx.last()).toEqual({
        kind: 'notice',
        message: 'This party has ended or the link is wrong.',
      }),
    )
  })

  it('shows "This party is full." when joining fails that way', async () => {
    const ctx = setup()
    await ctx.overlay.start()
    await vi.waitFor(() => expect(ctx.last()?.kind).toBe('invite'))
    ctx.send.mockResolvedValueOnce(fail('full'))
    await ctx.overlay.join()
    expect(ctx.last()).toMatchObject({ kind: 'invite', error: 'This party is full.' })
  })

  it('does nothing on pages without an invite', async () => {
    const ctx = setup(WATCH)
    await ctx.overlay.start()
    expect(ctx.replaceUrl).not.toHaveBeenCalled()
    expect(ctx.send).toHaveBeenCalledTimes(1) // party:get-for-tab only
    expect(ctx.views).toEqual([])
  })

  it('picks up a party the tab is already in and applies its state', async () => {
    const ctx = setup(WATCH)
    ctx.replies['party:get-for-tab'] = view({ state: playbackState() })
    await ctx.overlay.start()
    expect(ctx.last()).toMatchObject({ kind: 'pill', label: 'Watch party · 3 watching' })
    expect(ctx.video.currentTime).toBe(105)
    expect(ctx.video.play).toHaveBeenCalled()
  })

  it('follows member counts, hides during ads, and shows the end of the party', async () => {
    const ctx = setup(WATCH)
    ctx.replies['party:get-for-tab'] = view()
    await ctx.overlay.start()
    ctx.overlay.receive({ type: 'party:members', code: 'K7xQ2m', count: 5 })
    expect(ctx.last()).toMatchObject({ label: 'Watch party · 5 watching' })

    ctx.page.ad = true
    ctx.overlay.tick()
    expect(ctx.last()).toBeNull()
    ctx.page.ad = false
    ctx.overlay.tick()
    expect(ctx.last()).toMatchObject({ kind: 'pill' })

    ctx.overlay.receive({ type: 'party:ended', code: 'K7xQ2m', reason: 'ended' })
    expect(ctx.last()).toMatchObject({ kind: 'ended', message: 'The party has ended' })
    ctx.page.now += ENDED_NOTICE_MS
    ctx.overlay.tick()
    expect(ctx.last()).toBeNull()
    expect(ctx.overlay.inParty).toBe(false)
  })

  it('reports the viewer’s actions on the main video only', async () => {
    const ctx = setup(WATCH)
    ctx.replies['party:get-for-tab'] = view()
    await ctx.overlay.start()
    ctx.video.paused = false
    ctx.video.currentTime = 12
    ctx.overlay.mediaEvent('play', {} as EventTarget) // a hover preview, not the player
    ctx.overlay.mediaEvent('play', ctx.video as unknown as EventTarget)
    expect(ctx.send).toHaveBeenCalledWith({
      type: 'party:report',
      adapter: 'youtube',
      action: 'play',
      position: 12,
      rate: 1,
    })
    expect(ctx.send.mock.calls.filter(([m]) => m.type === 'party:report')).toHaveLength(1)
  })

  it('labels the pill', () => {
    expect(membersLabel(1)).toBe('Watch party · 1 watching')
    expect(membersLabel(0)).toBe('Watch party · 1 watching')
  })
})
