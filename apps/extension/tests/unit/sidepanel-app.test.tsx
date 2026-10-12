// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { PartyTabView } from '../../src/party/rooms'
import { expectNoA11yViolations } from './a11y'

const send = vi.fn()
vi.mock('../../src/messaging/protocol', async (original) => ({
  ...(await original<typeof import('../../src/messaging/protocol')>()),
  send: (message: { type: string }) => send(message),
  onBroadcast: () => () => undefined,
}))

let partyView: PartyTabView | null = null
vi.mock('../../src/features/party/usePartyRoom', () => ({
  usePartyRoom: () => ({
    view: partyView,
    error: null,
    sendChat: vi.fn(),
    react: vi.fn(),
    clearError: vi.fn(),
  }),
  usePageVisible: () => true,
  usePanelPresence: () => undefined,
}))

const { App } = await import('../../entrypoints/sidepanel/App')

const profile = { id: 'p1', name: 'Kai', avatar_color: '#d32f23', is_kids: false, created_at: '' }

function answer(replies: Record<string, unknown>) {
  send.mockImplementation(async (message: { type: string }) => replies[message.type] ?? null)
}

const signedIn = {
  'session:get': { signedIn: true, displayName: 'Kai' },
  'profiles:list': { ok: true, data: { profiles: [profile], activeProfileId: 'p1' } },
  'history:continue': { ok: true, data: [] },
  'streak:get': { ok: true, data: { current_days: 0, longest_days: 0, episodes_today: 0 } },
}

beforeEach(() => {
  partyView = null
  send.mockReset()
})
afterEach(() => cleanup())

describe('side panel', () => {
  it('asks you to sign in when signed out', async () => {
    answer({ 'session:get': { signedIn: false, displayName: null } })
    const { container } = render(<App />)
    expect(await screen.findByRole('button', { name: 'Sign in' })).toBeTruthy()
    expect(screen.queryByRole('tablist')).toBeNull()
    await expectNoA11yViolations(container)
  })

  it('shows Home with continue watching and the account menu when signed in', async () => {
    answer(signedIn)
    const { container } = render(<App />)
    expect((await screen.findByRole('tab', { name: 'Home' })).getAttribute('aria-selected')).toBe(
      'true',
    )
    expect(await screen.findByRole('heading', { name: 'Continue watching' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Account menu for Kai' })).toBeTruthy()
    // No party and no matched episode on this tab: only Home is offered.
    expect(screen.queryByRole('tab', { name: /Party/ })).toBeNull()
    expect(screen.queryByRole('tab', { name: 'Episodes' })).toBeNull()
    await expectNoA11yViolations(container)
  })

  it('opens the Party tab when this tab is in a party', async () => {
    answer(signedIn)
    partyView = {
      code: 'k3x9',
      inviteUrl: 'http://localhost:5173/party/k3x9',
      hostName: 'Kai',
      provider: 'youtube',
      watchUrl: 'https://www.youtube.com/watch?v=abc',
      memberCount: 2,
      status: 'live',
      state: null,
      clockOffsetMs: 0,
      members: [],
      youId: 'u1',
      chat: [],
      unread: 0,
    } as unknown as PartyTabView
    render(<App />)
    expect((await screen.findByRole('tab', { name: /Party/ })).getAttribute('aria-selected')).toBe(
      'true',
    )
  })
})
