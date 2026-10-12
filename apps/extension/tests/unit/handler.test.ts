import { describe, expect, it, vi } from 'vitest'

import { createHandler, type Sender, type Services } from '../../src/background/handler'
import { ok } from '../../src/lib/result'
import { item, match } from './fixtures'

const ORIGIN = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop/'
const popup: Sender = { url: `${ORIGIN}popup.html` }
const player: Sender = {
  url: 'https://www.youtube.com/watch?v=abc',
  tab: { id: 7, url: 'https://www.youtube.com/watch?v=abc' } as chrome.tabs.Tab,
}
const otherSite: Sender = {
  url: 'https://example.com/',
  tab: { id: 8, url: 'https://example.com/' } as chrome.tabs.Tab,
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
    continueWatching: vi.fn(async () => ok([])),
    streak: vi.fn(async () => ok({ current_days: 1, longest_days: 2, episodes_today: 3 })),
    episodeForTab: vi.fn(async () => null),
    show: vi.fn(async () =>
      ok({ id: 's', title: 'S', synopsis: '', poster_url: null, year: null, seasons: [] }),
    ),
    getSettings: vi.fn(async () => ({ countdownSeconds: 10 })),
    setSettings: vi.fn(async (s) => ({ countdownSeconds: s.countdownSeconds ?? 10 })),
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
      'history:continue',
      'streak:get',
    ] as const) {
      await handle({ type }, popup)
    }
    expect(services.signIn).toHaveBeenCalledOnce()
    expect(services.listProfiles).toHaveBeenCalledOnce()
    expect(services.continueWatching).toHaveBeenCalledOnce()
    expect(services.streak).toHaveBeenCalledOnce()
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
    expect(await handle({ type: 'history:continue' }, player)).toEqual({ ok: false })
    expect(services.signOut).not.toHaveBeenCalled()
    expect(services.continueWatching).not.toHaveBeenCalled()
  })

  it('ignores anything that is not a message', async () => {
    const handle = createHandler(fakeServices(), ORIGIN)
    expect(await handle(null, popup)).toBeUndefined()
    expect(await handle({ type: 'unknown' }, popup)).toBeUndefined()
  })
})
