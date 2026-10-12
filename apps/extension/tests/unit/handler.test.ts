import { describe, expect, it, vi } from 'vitest'

import { createHandler, type Sender, type Services } from '../../src/background/handler'
import { ok } from '../../src/lib/result'
import type { PartyTabView } from '../../src/messaging/protocol'
import { item, match } from './fixtures'

const ORIGIN = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop/'
const popup: Sender = { url: `${ORIGIN}popup.html` }
const player: Sender = {
  url: 'https://www.youtube.com/watch?v=abc',
  tab: { id: 7, url: 'https://www.youtube.com/watch?v=abc' } as chrome.tabs.Tab,
}
const ytHome: Sender = {
  url: 'https://www.youtube.com/',
  tab: { id: 9, url: 'https://www.youtube.com/' } as chrome.tabs.Tab,
}
const otherSite: Sender = {
  url: 'https://example.com/',
  tab: { id: 8, url: 'https://example.com/' } as chrome.tabs.Tab,
}

const partyView: PartyTabView = {
  code: 'K7xQ2m',
  inviteUrl: 'http://web.test/party/K7xQ2m',
  hostName: 'Kai',
  provider: 'youtube',
  watchUrl: 'https://www.youtube.com/watch?v=abc',
  memberCount: 2,
  status: 'live',
  state: null,
  clockOffsetMs: 0,
  members: [],
  youId: null,
  chat: [],
  system: [],
  unread: 0,
  panelOpen: false,
}

function fakeServices(): Services {
  return {
    pushProgress: vi.fn(async () => undefined),
    currentEpisode: vi.fn(async () => ok(match('e1'))),
    sessionState: vi.fn(async () => ({ signedIn: true, displayName: 'Kai' })),
    signIn: vi.fn(async () => ok({ signedIn: true, displayName: 'Kai' })),
    signOut: vi.fn(async () => undefined),
    listProfiles: vi.fn(async () => ok({ profiles: [], activeProfileId: null })),
    setProfile: vi.fn(async () => true),
    history: vi.fn(async () => ok([])),
    streak: vi.fn(async () => ok({ current_days: 1, longest_days: 2, episodes_today: 3 })),
    episodeForTab: vi.fn(async () => null),
    show: vi.fn(async () =>
      ok({ id: 's', title: 'S', synopsis: '', poster_url: null, year: null, seasons: [] }),
    ),
    getSettings: vi.fn(async () => ({ countdownSeconds: 10 })),
    setSettings: vi.fn(async (s) => ({ countdownSeconds: s.countdownSeconds ?? 10 })),
    startParty: vi.fn(async () => ok(partyView)),
    leaveParty: vi.fn(async () => undefined),
    partyForTab: vi.fn(async () => partyView),
    partyJoinRequest: vi.fn(async () => ok({ ...partyView, status: 'invited' as const })),
    reportPartyAction: vi.fn(async () => true),
    setPartyStatus: vi.fn(async () => true),
    reactInParty: vi.fn(async () => true),
    sendPartyChat: vi.fn(async () => true),
    markPartyRead: vi.fn(async () => undefined),
    openPanel: vi.fn(async () => true),
  }
}

describe('message handler', () => {
  it('routes extension-page messages to their service', async () => {
    const services = fakeServices()
    const handle = createHandler(services, ORIGIN)
    expect(await handle({ type: 'session:get' }, popup)).toEqual({
      signedIn: true,
      displayName: 'Kai',
    })
    expect(await handle({ type: 'session:sign-out' }, popup)).toEqual({ ok: true })
    expect(await handle({ type: 'profile:set', profileId: 'p1' }, popup)).toEqual({ ok: true })
    expect(services.setProfile).toHaveBeenCalledWith('p1')
    await handle({ type: 'show:get', showId: 's1' }, popup)
    expect(services.show).toHaveBeenCalledWith('s1')
    await handle({ type: 'episode:for-tab', tabId: 3 }, popup)
    expect(services.episodeForTab).toHaveBeenCalledWith(3)
    expect(
      await handle({ type: 'settings:set', settings: { countdownSeconds: 20 } }, popup),
    ).toEqual({
      countdownSeconds: 20,
    })
    for (const type of [
      'session:sign-in',
      'profiles:list',
      'history:list',
      'streak:get',
    ] as const) {
      await handle({ type }, popup)
    }
    expect(services.signIn).toHaveBeenCalledOnce()
    expect(services.listProfiles).toHaveBeenCalledOnce()
    expect(services.history).toHaveBeenCalledWith(null)
    expect(services.streak).toHaveBeenCalledOnce()
  })

  it('pages the watch history with a checked cursor', async () => {
    const services = fakeServices()
    const handle = createHandler(services, ORIGIN)
    const cursor = '2026-10-11T21:04:00Z'
    expect(await handle({ type: 'history:list', cursor }, popup)).toEqual(ok([]))
    expect(services.history).toHaveBeenCalledWith(cursor)
    expect(await handle({ type: 'history:list', cursor: 'yesterday' }, popup)).toEqual({
      ok: false,
      error: 'rejected',
    })
    expect(await handle({ type: 'history:list', cursor: 42 }, popup)).toEqual({
      ok: false,
      error: 'rejected',
    })
    expect(services.history).toHaveBeenCalledTimes(1)
  })

  it('accepts progress and episode lookups from a supported player tab', async () => {
    const services = fakeServices()
    const handle = createHandler(services, ORIGIN)
    const { snapshot } = item('abc')
    expect(await handle({ type: 'progress', adapter: 'youtube', snapshot }, player)).toEqual({
      ok: true,
    })
    expect(services.pushProgress).toHaveBeenCalledWith('youtube', snapshot)
    expect(await handle({ type: 'episode:current', adapter: 'youtube', snapshot }, player)).toEqual(
      ok(match('e1')),
    )
    expect(services.currentEpisode).toHaveBeenCalledWith(7, 'youtube', snapshot)
    expect(await handle({ type: 'settings:get' }, player)).toEqual({ countdownSeconds: 10 })
  })

  it('rejects progress from unsupported tabs, wrong adapters and bad snapshots', async () => {
    const services = fakeServices()
    const handle = createHandler(services, ORIGIN)
    const { snapshot } = item('abc')
    expect(await handle({ type: 'progress', adapter: 'youtube', snapshot }, otherSite)).toEqual({
      ok: false,
    })
    expect(await handle({ type: 'progress', adapter: 'netflix', snapshot }, player)).toEqual({
      ok: false,
    })
    expect(
      await handle({ type: 'progress', adapter: 'youtube', snapshot: { nope: 1 } }, player),
    ).toEqual({
      ok: false,
    })
    expect(await handle({ type: 'progress', adapter: 'youtube', snapshot }, popup)).toEqual({
      ok: false,
    })
    expect(services.pushProgress).not.toHaveBeenCalled()
  })

  it('keeps account messages away from content scripts', async () => {
    const services = fakeServices()
    const handle = createHandler(services, ORIGIN)
    expect(await handle({ type: 'session:sign-out' }, player)).toEqual({ ok: false })
    expect(await handle({ type: 'history:list' }, player)).toEqual({ ok: false })
    expect(services.signOut).not.toHaveBeenCalled()
    expect(services.history).not.toHaveBeenCalled()
  })

  it('ignores anything that is not a message', async () => {
    const handle = createHandler(fakeServices(), ORIGIN)
    expect(await handle(null, popup)).toBeUndefined()
    expect(await handle({ type: 'unknown' }, popup)).toBeUndefined()
  })

  describe('watch party messages', () => {
    it('lets extension pages start, leave and look up any tab’s party', async () => {
      const services = fakeServices()
      const handle = createHandler(services, ORIGIN)
      expect(await handle({ type: 'party:start', tabId: 7 }, popup)).toEqual(ok(partyView))
      expect(services.startParty).toHaveBeenCalledWith(7)
      expect(await handle({ type: 'party:get-for-tab', tabId: 7 }, popup)).toEqual(partyView)
      expect(services.partyForTab).toHaveBeenCalledWith(7)
      expect(await handle({ type: 'party:leave', tabId: 7 }, popup)).toEqual({ ok: true })
      expect(services.leaveParty).toHaveBeenCalledWith(7)
      expect(await handle({ type: 'party:start', tabId: 'x' }, popup)).toEqual({
        ok: false,
        error: 'rejected',
      })
    })

    it('keeps start and leave away from content scripts', async () => {
      const services = fakeServices()
      const handle = createHandler(services, ORIGIN)
      expect(await handle({ type: 'party:start', tabId: 7 }, player)).toEqual({ ok: false })
      expect(await handle({ type: 'party:leave', tabId: 7 }, player)).toEqual({ ok: false })
      expect(services.startParty).not.toHaveBeenCalled()
      expect(services.leaveParty).not.toHaveBeenCalled()
    })

    it('answers a content script about its own player tab only', async () => {
      const services = fakeServices()
      const handle = createHandler(services, ORIGIN)
      await handle({ type: 'party:get-for-tab', tabId: 99 }, player)
      expect(services.partyForTab).toHaveBeenCalledWith(7)
      expect(await handle({ type: 'party:get-for-tab' }, ytHome)).toBeNull()
      expect(await handle({ type: 'party:get-for-tab' }, otherSite)).toBeNull()
      expect(services.partyForTab).toHaveBeenCalledOnce()
    })

    it('relays reported actions from the player tab, checked field by field', async () => {
      const services = fakeServices()
      const handle = createHandler(services, ORIGIN)
      const report = { type: 'party:report', adapter: 'youtube', action: 'seek', position: 42.5 }
      expect(await handle({ ...report, rate: 1.5 }, player)).toEqual({ ok: true })
      expect(services.reportPartyAction).toHaveBeenCalledWith(7, {
        action: 'seek',
        position: 42.5,
        rate: 1.5,
      })
      expect(await handle(report, player)).toEqual({ ok: true })
      expect(services.reportPartyAction).toHaveBeenLastCalledWith(7, {
        action: 'seek',
        position: 42.5,
        rate: 1,
      })

      for (const bad of [
        { ...report, action: 'rewind' },
        { ...report, position: -1 },
        { ...report, position: Number.NaN },
        { ...report, position: '5' },
        { ...report, rate: 0 },
        { ...report, rate: 100 },
        { ...report, adapter: 'netflix' },
      ]) {
        expect(await handle(bad, player)).toEqual({ ok: false })
      }
      expect(await handle(report, ytHome)).toEqual({ ok: false })
      expect(await handle(report, otherSite)).toEqual({ ok: false })
      expect(await handle(report, popup)).toEqual({ ok: false })
      expect(services.reportPartyAction).toHaveBeenCalledTimes(2)
    })

    it('passes invite links from the player tab on, with the tab’s URL', async () => {
      const services = fakeServices()
      const handle = createHandler(services, ORIGIN)
      const ask = { type: 'party:join-request', adapter: 'youtube', code: 'K7xQ2m', confirm: false }
      expect(await handle(ask, player)).toMatchObject({ ok: true })
      expect(services.partyJoinRequest).toHaveBeenCalledWith(
        7,
        'https://www.youtube.com/watch?v=abc',
        'K7xQ2m',
        false,
      )
      await handle({ ...ask, confirm: true }, player)
      expect(services.partyJoinRequest).toHaveBeenLastCalledWith(
        7,
        'https://www.youtube.com/watch?v=abc',
        'K7xQ2m',
        true,
      )

      const rejected = { ok: false, error: 'rejected' }
      expect(await handle({ ...ask, code: '../../x' }, player)).toEqual(rejected)
      expect(await handle({ ...ask, code: 42 }, player)).toEqual(rejected)
      expect(await handle(ask, otherSite)).toEqual(rejected)
      expect(await handle(ask, popup)).toEqual(rejected)
      expect(services.partyJoinRequest).toHaveBeenCalledTimes(2)
    })
  })

  describe('watch party chat, reactions and presence', () => {
    it('takes a status from the player tab, checked', async () => {
      const services = fakeServices()
      const handle = createHandler(services, ORIGIN)
      const status = { type: 'party:status', adapter: 'youtube', status: 'buffering' }
      expect(await handle(status, player)).toEqual({ ok: true })
      expect(services.setPartyStatus).toHaveBeenCalledWith(7, 'buffering')
      for (const [bad, sender] of [
        [{ ...status, status: 'sleeping' }, player],
        [{ ...status, adapter: 'netflix' }, player],
        [status, ytHome],
        [status, otherSite],
        [status, popup],
      ] as const) {
        expect(await handle(bad, sender)).toEqual({ ok: false })
      }
      expect(services.setPartyStatus).toHaveBeenCalledOnce()
    })

    it('takes reactions from the player tab (its own tab) and from extension pages', async () => {
      const services = fakeServices()
      const handle = createHandler(services, ORIGIN)
      expect(await handle({ type: 'party:react', kind: 'fire', tabId: 99 }, player)).toEqual({
        ok: true,
      })
      expect(services.reactInParty).toHaveBeenLastCalledWith(7, 'fire')
      expect(await handle({ type: 'party:react', kind: 'clap', tabId: 3 }, popup)).toEqual({
        ok: true,
      })
      expect(services.reactInParty).toHaveBeenLastCalledWith(3, 'clap')
      expect(await handle({ type: 'party:react', kind: 'poop', tabId: 3 }, popup)).toEqual({
        ok: false,
      })
      expect(await handle({ type: 'party:react', kind: 'fire' }, popup)).toEqual({ ok: false })
      expect(await handle({ type: 'party:react', kind: 'fire' }, otherSite)).toEqual({ ok: false })
      expect(await handle({ type: 'party:react', kind: 'fire' }, ytHome)).toEqual({ ok: false })
      expect(services.reactInParty).toHaveBeenCalledTimes(2)
    })

    it('sends chat from extension pages only, trimmed and within 500 characters', async () => {
      const services = fakeServices()
      const handle = createHandler(services, ORIGIN)
      const chat = { type: 'party:send-chat', tabId: 7, text: '  that ending  ' }
      expect(await handle(chat, popup)).toEqual({ ok: true })
      expect(services.sendPartyChat).toHaveBeenCalledWith(7, 'that ending')
      for (const bad of [
        { ...chat, text: '   ' },
        { ...chat, text: 'a'.repeat(501) },
        { ...chat, text: 42 },
        { ...chat, tabId: '7' },
      ]) {
        expect(await handle(bad, popup)).toEqual({ ok: false })
      }
      expect(await handle(chat, player)).toEqual({ ok: false })
      expect(services.sendPartyChat).toHaveBeenCalledOnce()
    })

    it('marks a tab’s chat read for extension pages only', async () => {
      const services = fakeServices()
      const handle = createHandler(services, ORIGIN)
      expect(await handle({ type: 'party:mark-read', tabId: 7 }, popup)).toEqual({ ok: true })
      expect(services.markPartyRead).toHaveBeenCalledWith(7)
      expect(await handle({ type: 'party:mark-read', tabId: 7 }, player)).toEqual({ ok: false })
      expect(await handle({ type: 'party:mark-read' }, popup)).toEqual({ ok: false })
      expect(services.markPartyRead).toHaveBeenCalledOnce()
    })

    it('opens the side panel for the player tab that asked, before any await', () => {
      const services = fakeServices()
      const handle = createHandler(services, ORIGIN)
      void handle({ type: 'party:open-panel' }, player)
      // Synchronously: the click's user gesture must still be current.
      expect(services.openPanel).toHaveBeenCalledWith(7)
    })

    it('refuses to open the side panel for anything but a player tab', async () => {
      const services = fakeServices()
      const handle = createHandler(services, ORIGIN)
      expect(await handle({ type: 'party:open-panel' }, popup)).toEqual({ ok: false })
      expect(await handle({ type: 'party:open-panel' }, otherSite)).toEqual({ ok: false })
      expect(services.openPanel).not.toHaveBeenCalled()
      vi.mocked(services.openPanel).mockResolvedValueOnce(false)
      expect(await handle({ type: 'party:open-panel' }, player)).toEqual({ ok: false })
    })
  })
})
