import { describe, expect, it } from 'vitest'

import {
  CHAT_HISTORY_LIMIT,
  parseServerMessage,
  toEpochSeconds,
  type ChatMessage,
} from '../../src/party/protocol'
import { playbackState } from './fixtures'

const frame = (value: unknown) => parseServerMessage(JSON.stringify(value))

const sam = { id: 'u2', display_name: 'Sam' }
const member = (overrides: Record<string, unknown> = {}) => ({
  id: 'u1',
  display_name: 'Kai',
  is_host: true,
  status: 'watching',
  joined_at: 1_000,
  ...overrides,
})
const chat = (id: string, sentAt = 1_000): ChatMessage => ({
  id,
  user: sam,
  text: 'that ending',
  sent_at: sentAt,
})

describe('party protocol: presence, chat and reactions', () => {
  it('parses presence frames and skips malformed members', () => {
    expect(
      frame({
        type: 'presence',
        members: [
          member(),
          member({ id: 'u2', display_name: 'Sam', is_host: false, status: 'ad' }),
          { id: 7 },
          member({ id: 'u3', display_name: 'Ana', status: 'dancing', joined_at: undefined }),
        ],
      }),
    ).toEqual({
      type: 'presence',
      members: [
        member(),
        member({ id: 'u2', display_name: 'Sam', is_host: false, status: 'ad' }),
        // Unknown statuses read as watching; a missing join time as 0.
        member({ id: 'u3', display_name: 'Ana', status: 'watching', joined_at: 0 }),
      ],
    })
    expect(frame({ type: 'presence', members: 'everyone' })).toBeNull()
  })

  it('accepts ISO timestamps as well as epoch seconds', () => {
    expect(toEpochSeconds('1970-01-01T00:16:40Z')).toBe(1_000)
    expect(toEpochSeconds(1_000.5)).toBe(1_000.5)
    expect(toEpochSeconds('yesterday')).toBeNull()
    expect(
      frame({ type: 'presence', members: [member({ joined_at: '1970-01-01T00:16:40Z' })] }),
    ).toEqual({ type: 'presence', members: [member()] })
  })

  it('parses chat frames and rejects broken ones', () => {
    expect(frame({ type: 'chat', message: chat('m1') })).toEqual({
      type: 'chat',
      message: chat('m1'),
    })
    // Extra user fields from the server are not carried along.
    expect(
      frame({ type: 'chat', message: { ...chat('m1'), user: { ...sam, email: 'x@y.z' } } }),
    ).toEqual({ type: 'chat', message: chat('m1') })
    expect(frame({ type: 'chat', message: { ...chat('m1'), text: 5 } })).toBeNull()
    expect(frame({ type: 'chat', message: { ...chat('m1'), id: '' } })).toBeNull()
    expect(frame({ type: 'chat', message: { ...chat('m1'), user: null } })).toBeNull()
    expect(frame({ type: 'chat', message: { ...chat('m1'), sent_at: 'soon' } })).toBeNull()
    expect(frame({ type: 'chat' })).toBeNull()
  })

  it('parses reactions of the six known kinds only', () => {
    const reaction = { type: 'reaction', id: 'r1', kind: 'fire', user: sam, at: 1_001 }
    expect(frame(reaction)).toEqual({
      type: 'reaction',
      reaction: { id: 'r1', kind: 'fire', user: sam, at: 1_001 },
    })
    for (const kind of ['heart', 'laugh', 'wow', 'fire', 'clap', 'sad']) {
      expect(frame({ ...reaction, kind })).not.toBeNull()
    }
    expect(frame({ ...reaction, kind: 'poop' })).toBeNull()
    expect(frame({ ...reaction, user: 'Sam' })).toBeNull()
    expect(frame({ ...reaction, id: undefined })).toBeNull()
  })

  it('reads the member list and chat history from the welcome', () => {
    const history = Array.from({ length: 55 }, (_, i) => chat(`m${i}`, 1_000 + i))
    const parsed = frame({
      type: 'welcome',
      state: playbackState(),
      members: 2,
      you: { ...sam, extra: true },
      members_list: [member(), member({ id: 'u2', display_name: 'Sam', is_host: false })],
      chat: [...history, { broken: true }],
    })
    expect(parsed).toMatchObject({
      type: 'welcome',
      you: sam,
      members_list: [
        { id: 'u1', is_host: true },
        { id: 'u2', is_host: false },
      ],
    })
    const messages = parsed?.type === 'welcome' ? parsed.chat : []
    expect(messages).toHaveLength(CHAT_HISTORY_LIMIT)
    expect(messages[0]?.id).toBe('m5')
    expect(messages.at(-1)?.id).toBe('m54')
  })

  it('keeps an older welcome without the new fields working', () => {
    expect(frame({ type: 'welcome', state: playbackState(), members: 1, you: sam })).toMatchObject({
      members_list: [],
      chat: [],
    })
  })

  it('passes server errors on as sentences and still ignores unknown frames', () => {
    expect(frame({ type: 'error', detail: "You're sending messages too quickly." })).toEqual({
      type: 'error',
      detail: "You're sending messages too quickly.",
    })
    expect(frame({ type: 'typing', user: sam })).toBeNull()
  })
})
