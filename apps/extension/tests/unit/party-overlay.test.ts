import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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
  members: [],
  youId: 'u1',
  chat: [],
  unread: 0,
  panelOpen: false,
  ...overrides,
})

function setup(href = `${WATCH}#nightreel-party=K7xQ2m`) {
  const page = {
    href,
    ad: false,
    now: 1_005_000,
    hidden: false,
    reduced: false,
    fullscreen: false,
  }
  const video = {
    paused: true,
    currentTime: 0,
    playbackRate: 1,
    play: vi.fn(async () => undefined),
    pause: vi.fn(),
    getBoundingClientRect: () => ({ top: 56, right: 1000, bottom: 596, width: 960, height: 540 }),
  }
  const doc = {
    get location() {
      return { href: page.href }
    },
    get visibilityState() {
      return page.hidden ? 'hidden' : 'visible'
    },
    get fullscreenElement() {
      return page.fullscreen ? {} : null
    },
    documentElement: { clientWidth: 1200, clientHeight: 800 },
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
    reducedMotion: () => page.reduced,
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
      chat: { unread: 0, panelOpen: false, reactionsOpen: false, toast: null, hint: null },
      reactions: [],
      stage: null,
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

  describe('chat and reactions on the pill', () => {
    const sam = { id: 'u2', display_name: 'Sam' }
    const chat = (id: string, text = 'that ending') => ({
      id,
      user: sam,
      text,
      sent_at: 1_000,
    })
    const pill = (ctx: ReturnType<typeof setup>) => {
      const last = ctx.last()
      if (last?.kind !== 'pill') throw new Error(`expected the pill, got ${last?.kind}`)
      return last
    }

    async function inParty(overrides: Partial<PartyTabView> = {}) {
      const ctx = setup(WATCH)
      ctx.replies['party:get-for-tab'] = view(overrides)
      await ctx.overlay.start()
      return ctx
    }

    it('starts from the tab’s unread count', async () => {
      const ctx = await inParty({ unread: 2 })
      expect(pill(ctx).chat).toMatchObject({ unread: 2, panelOpen: false })
    })

    it('shows a chat bubble for 4 s while the side panel is closed, and the unread count', async () => {
      const ctx = await inParty()
      ctx.overlay.receive({
        type: 'party:chat',
        code: 'K7xQ2m',
        message: chat('m1'),
        unread: 1,
        panelOpen: false,
      })
      ctx.overlay.receive({
        type: 'party:chat',
        code: 'K7xQ2m',
        message: chat('m2', 'x'.repeat(200)),
        unread: 2,
        panelOpen: false,
      })
      expect(pill(ctx).chat).toMatchObject({ unread: 2, toast: { text: 'Sam: that ending' } })
      ctx.page.now += 4_000
      ctx.overlay.tick()
      const next = pill(ctx).chat.toast
      expect(next?.id).toBe('m2')
      expect(Array.from(next?.text ?? '')).toHaveLength(80)
      ctx.page.now += 4_000
      ctx.overlay.tick()
      expect(pill(ctx).chat.toast).toBeNull()
    })

    it('shows no bubbles or count while the side panel is open', async () => {
      const ctx = await inParty({ panelOpen: true })
      ctx.overlay.receive({
        type: 'party:chat',
        code: 'K7xQ2m',
        message: chat('m1'),
        unread: 0,
        panelOpen: true,
      })
      expect(pill(ctx).chat).toMatchObject({ unread: 0, toast: null, panelOpen: true })
    })

    it('drops the bubble when the panel opens, and hides it in fullscreen', async () => {
      const ctx = await inParty()
      const message = {
        type: 'party:chat',
        code: 'K7xQ2m',
        message: chat('m1'),
        unread: 1,
        panelOpen: false,
      } as const
      ctx.overlay.receive(message)
      ctx.page.fullscreen = true
      ctx.overlay.tick()
      expect(pill(ctx).chat.toast).toBeNull()
      ctx.page.fullscreen = false
      ctx.overlay.tick()
      expect(pill(ctx).chat.toast).not.toBeNull()
      ctx.overlay.receive({ type: 'party:unread', code: 'K7xQ2m', unread: 0, panelOpen: true })
      expect(pill(ctx).chat).toMatchObject({ toast: null, unread: 0 })
    })

    it('floats reactions above the controls, never during ads', async () => {
      const ctx = await inParty()
      const reaction = { id: 'r1', kind: 'fire' as const, user: sam, at: 1 }
      ctx.overlay.receive({ type: 'party:reaction', code: 'K7xQ2m', reaction })
      expect(pill(ctx).reactions).toMatchObject([{ id: 'r1', kind: 'fire', name: 'Sam' }])
      expect(pill(ctx).stage).toEqual({ bottom: 276, right: 224 })

      ctx.page.ad = true
      ctx.overlay.receive({
        type: 'party:reaction',
        code: 'K7xQ2m',
        reaction: { ...reaction, id: 'r2' },
      })
      ctx.overlay.tick()
      expect(ctx.last()).toBeNull()
      ctx.page.ad = false
      ctx.overlay.tick()
      expect(pill(ctx).reactions.map((r) => r.id)).toEqual(['r1'])
      ctx.page.now += 1_200
      ctx.overlay.tick()
      expect(pill(ctx).reactions).toEqual([])
    })

    it('fades reactions in place for reduced motion', async () => {
      const ctx = await inParty()
      ctx.page.reduced = true
      ctx.overlay.receive({
        type: 'party:reaction',
        code: 'K7xQ2m',
        reaction: { id: 'r1', kind: 'sad', user: sam, at: 1 },
      })
      expect(pill(ctx).reactions[0]?.motion).toBe('fade')
    })

    it('opens the reactions and sends the chosen one', async () => {
      const ctx = await inParty()
      ctx.overlay.toggleReactions()
      expect(pill(ctx).chat.reactionsOpen).toBe(true)
      ctx.overlay.react('clap')
      expect(ctx.send).toHaveBeenCalledWith({ type: 'party:react', kind: 'clap' })
      ctx.overlay.closeReactions()
      expect(pill(ctx).chat.reactionsOpen).toBe(false)
    })

    it('asks the service worker to open the side panel, and explains when it cannot', async () => {
      const ctx = await inParty()
      ctx.replies['party:open-panel'] = { ok: true }
      await ctx.overlay.openPanel()
      expect(ctx.send).toHaveBeenCalledWith({ type: 'party:open-panel' })
      expect(pill(ctx).chat.hint).toBeNull()
      ctx.replies['party:open-panel'] = { ok: false }
      await ctx.overlay.openPanel()
      expect(pill(ctx).chat.hint).toBe('Open the side panel to chat')
      ctx.page.now += 4_000
      ctx.overlay.tick()
      expect(pill(ctx).chat.hint).toBeNull()
    })
  })

  describe('status', () => {
    beforeEach(() => vi.useFakeTimers())
    afterEach(() => vi.useRealTimers())

    const statuses = (ctx: ReturnType<typeof setup>) =>
      ctx.send.mock.calls
        .map(([m]) => m)
        .filter((m) => m.type === 'party:status')
        .map((m) => (m.type === 'party:status' ? m.status : null))

    async function inParty() {
      const ctx = setup(WATCH)
      ctx.replies['party:get-for-tab'] = view()
      await ctx.overlay.start()
      return ctx
    }

    it('reports ads, buffering and being away, once each, after a short wait', async () => {
      const ctx = await inParty()
      ctx.page.ad = true
      ctx.overlay.tick()
      ctx.overlay.tick()
      await vi.advanceTimersByTimeAsync(500)
      expect(statuses(ctx)).toEqual(['ad'])

      ctx.page.ad = false
      ctx.overlay.mediaEvent('waiting', ctx.video as unknown as EventTarget)
      await vi.advanceTimersByTimeAsync(500)
      ctx.overlay.mediaEvent('playing', ctx.video as unknown as EventTarget)
      await vi.advanceTimersByTimeAsync(500)
      expect(statuses(ctx)).toEqual(['ad', 'buffering', 'watching'])

      ctx.page.hidden = true
      ctx.overlay.visibilityChanged()
      ctx.page.now += 5_001
      ctx.overlay.tick()
      await vi.advanceTimersByTimeAsync(500)
      expect(statuses(ctx)).toEqual(['ad', 'buffering', 'watching', 'away'])
      expect(ctx.send).toHaveBeenCalledWith({
        type: 'party:status',
        adapter: 'youtube',
        status: 'away',
      })
    })

    it('does not report a quick blip', async () => {
      const ctx = await inParty()
      ctx.overlay.mediaEvent('waiting', ctx.video as unknown as EventTarget)
      await vi.advanceTimersByTimeAsync(200)
      ctx.overlay.mediaEvent('playing', ctx.video as unknown as EventTarget)
      ctx.page.hidden = true
      ctx.overlay.visibilityChanged()
      ctx.page.now += 3_000
      ctx.overlay.tick()
      await vi.advanceTimersByTimeAsync(2_000)
      expect(statuses(ctx)).toEqual([])
    })
  })
})
