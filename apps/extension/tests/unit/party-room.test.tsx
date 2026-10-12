// @vitest-environment jsdom
import { initials } from '@nightreel/shared'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { PartyOverlayView } from '../../src/features/party/overlay'
import { chatButtonLabel, PartyOverlay } from '../../src/features/party/PartyOverlay'
import { PartyRoom, type PartyRoomProps } from '../../src/features/party/PartyRoom'
import type { ChatMessage, RoomMember } from '../../src/party/protocol'
import { expectNoA11yViolations } from './a11y'

afterEach(() => cleanup())

const NOW = 2_000_000_000 // ms
const members: RoomMember[] = [
  { id: 'u2', display_name: 'Sam Rivera', is_host: false, status: 'buffering', joined_at: 2 },
  { id: 'u1', display_name: 'Kai', is_host: true, status: 'watching', joined_at: 1 },
  { id: 'u3', display_name: 'Ana', is_host: false, status: 'ad', joined_at: 3 },
  { id: 'u4', display_name: 'Lee', is_host: false, status: 'away', joined_at: 4 },
]
const chat: ChatMessage[] = [
  {
    id: 'm1',
    user: { id: 'u2', display_name: 'Sam Rivera' },
    text: 'that ending',
    sent_at: NOW / 1000 - 180,
  },
  { id: 'm2', user: { id: 'u1', display_name: 'Kai' }, text: 'right?', sent_at: NOW / 1000 - 5 },
]

function setup(overrides: Partial<PartyRoomProps> = {}) {
  const props: PartyRoomProps = {
    members,
    youId: 'u1',
    chat,
    connection: 'live',
    error: null,
    onSend: vi.fn(async () => true),
    onReact: vi.fn(),
    onClearError: vi.fn(),
    now: () => NOW,
    ...overrides,
  }
  const utils = render(<PartyRoom {...props} />)
  return { ...utils, props, user: userEvent.setup() }
}

describe('Party tab', () => {
  it('lists who is here with host, you and status words', () => {
    setup()
    const list = screen.getByRole('list', { name: 'People in the party' })
    const rows = within(list).getAllByRole('listitem')
    // Host first, then by join time.
    const text = (row: HTMLElement) =>
      row.textContent?.replace(row.querySelector('.nr-avatar')?.textContent ?? '', '')
    expect(rows.map(text)).toEqual([
      'Kai (you)HostWatching',
      'Sam RiveraBuffering',
      'AnaWatching an ad',
      'LeeAway',
    ])
    // Initials are decorative next to the visible name.
    expect(rows[1]?.querySelector('.nr-avatar')?.textContent).toBe(initials('Sam Rivera'))
    expect(rows[1]?.querySelector('.nr-avatar')?.getAttribute('aria-hidden')).toBe('true')
  })

  it('shows the chat log with names, times and your own messages marked', () => {
    setup()
    const log = screen.getByRole('log', { name: 'Chat messages' })
    expect(log.getAttribute('aria-live')).toBe('polite')
    const items = within(log).getAllByRole('listitem')
    expect(items[0]?.textContent).toBe('Sam Rivera3 min agothat ending')
    expect(items[1]?.textContent).toBe('Younowright?')
    expect(items[1]?.className).toContain('nr-chat__msg--own')
  })

  it('renders chat as plain text', () => {
    setup({
      chat: [
        {
          id: 'x',
          user: { id: 'u2', display_name: '<i>Sam</i>' },
          text: '<img src=x onerror=alert(1)> https://example.com',
          sent_at: NOW / 1000,
        },
      ],
    })
    const log = screen.getByRole('log')
    expect(log.querySelector('img, i, a')).toBeNull()
    expect(log.textContent).toContain('<img src=x onerror=alert(1)> https://example.com')
  })

  it('sends with Enter and clears the box', async () => {
    const { props, user } = setup()
    const input = screen.getByLabelText('Message')
    await user.type(input, '  what a twist  {Enter}')
    expect(props.onSend).toHaveBeenCalledWith('what a twist')
    expect((input as HTMLInputElement).value).toBe('')
  })

  it('sends with the send button, which stays off for an empty message', async () => {
    const { props, user } = setup()
    const button = screen.getByRole('button', { name: 'Send message' })
    expect(button).toHaveProperty('disabled', true)
    await user.type(screen.getByLabelText('Message'), 'hi')
    expect(button).toHaveProperty('disabled', false)
    await user.click(button)
    expect(props.onSend).toHaveBeenCalledWith('hi')
  })

  it('shows the server’s error under the input and gives the text back', async () => {
    const { props, user, rerender } = setup()
    const input = screen.getByLabelText('Message') as HTMLInputElement
    await user.type(input, 'too fast{Enter}')
    expect(input.value).toBe('')
    rerender(<PartyRoom {...props} error="You're sending messages too quickly." />)
    expect(screen.getByRole('alert').textContent).toBe("You're sending messages too quickly.")
    expect(input.value).toBe('too fast')
    expect(input.getAttribute('aria-invalid')).toBe('true')
    expect(input.getAttribute('aria-describedby')).toContain(screen.getByRole('alert').id)
    await user.type(input, '!')
    expect(props.onClearError).toHaveBeenCalled()
  })

  it('says when a message could not be sent', async () => {
    const { user } = setup({ onSend: vi.fn(async () => false) })
    await user.type(screen.getByLabelText('Message'), 'hello{Enter}')
    expect(screen.getByRole('alert').textContent).toBe(
      'Your message was not sent. Try again in a moment.',
    )
  })

  it('shows a counter near the 500 character limit', async () => {
    const { user } = setup()
    const input = screen.getByLabelText('Message') as HTMLInputElement
    expect(input.maxLength).toBe(500)
    await user.click(input)
    await user.paste('a'.repeat(460))
    expect(screen.getByText('40 characters left')).toBeTruthy()
  })

  it('is disabled with a reason while reconnecting', () => {
    setup({ connection: 'reconnecting' })
    expect(screen.getByLabelText('Message')).toHaveProperty('disabled', true)
    expect(screen.getByText('Reconnecting. You can chat again in a moment.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'React with heart' })).toHaveProperty(
      'disabled',
      true,
    )
  })

  it('sends reactions from the six buttons', async () => {
    const { props, user } = setup()
    const group = screen.getByRole('group', { name: 'Reactions' })
    expect(
      within(group)
        .getAllByRole('button')
        .map((b) => b.getAttribute('aria-label')),
    ).toEqual([
      'React with heart',
      'React with laugh',
      'React with wow',
      'React with fire',
      'React with clap',
      'React with sad',
    ])
    await user.click(screen.getByRole('button', { name: 'React with fire' }))
    expect(props.onReact).toHaveBeenCalledWith('fire')
  })

  it('has no axe violations', async () => {
    const { container } = setup({ error: "You're sending messages too quickly." })
    await expectNoA11yViolations(container)
  })

  it('waits politely before the member list arrives', async () => {
    const { container } = setup({ members: [], chat: [], connection: 'connecting' })
    expect(screen.getByText('Waiting for the party to connect…')).toBeTruthy()
    expect(screen.getByText('No messages yet. Say hi to the party.')).toBeTruthy()
    await expectNoA11yViolations(container)
  })
})

describe('pill over the player', () => {
  const pill = (chat: Partial<Extract<PartyOverlayView, { kind: 'pill' }>['chat']> = {}) =>
    ({
      kind: 'pill',
      label: 'Watch party · 3 watching',
      needsClick: false,
      anchor: { top: 68, right: 212 },
      chat: {
        unread: 0,
        panelOpen: false,
        reactionsOpen: false,
        toast: null,
        hint: null,
        ...chat,
      },
      reactions: [
        { id: 'r1', kind: 'heart', name: 'Sam', startedAt: 0, offset: 4, motion: 'float' },
      ],
      stage: { bottom: 100, right: 40 },
    }) satisfies PartyOverlayView

  const handlers = () => ({
    onJoin: vi.fn(),
    onDismiss: vi.fn(),
    onResync: vi.fn(),
    onOpenPanel: vi.fn(),
    onToggleReactions: vi.fn(),
    onCloseReactions: vi.fn(),
    onReact: vi.fn(),
  })

  it('shows the unread count and opens the panel', async () => {
    const h = handlers()
    render(<PartyOverlay view={pill({ unread: 3 })} {...h} />)
    expect(chatButtonLabel(0)).toBe('Open chat')
    await userEvent.setup().click(screen.getByRole('button', { name: 'Open chat, 3 unread' }))
    expect(h.onOpenPanel).toHaveBeenCalled()
  })

  it('expands the six reactions inline, and shows a chat bubble', async () => {
    const h = handlers()
    const { container } = render(
      <PartyOverlay
        view={pill({ reactionsOpen: true, toast: { id: 'm1', text: 'Sam: that ending' } })}
        {...h}
      />,
    )
    const toggle = screen.getByRole('button', { name: 'Reactions' })
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    const tray = screen.getByRole('group', { name: 'Reactions' })
    expect(within(tray).getAllByRole('button')).toHaveLength(6)
    await userEvent.setup().click(screen.getByRole('button', { name: 'React with clap' }))
    expect(h.onReact).toHaveBeenCalledWith('clap')
    expect(screen.getByText('Sam: that ending')).toBeTruthy()
    // Floating reactions are decorative.
    expect(container.querySelector('.nr-reactions')?.getAttribute('aria-hidden')).toBe('true')
    await expectNoA11yViolations(container)
  })

  it('says how to open the panel when it cannot be opened from the page', () => {
    render(<PartyOverlay view={pill({ hint: 'Open the side panel to chat' })} {...handlers()} />)
    expect(screen.getByText('Open the side panel to chat')).toBeTruthy()
  })
})
