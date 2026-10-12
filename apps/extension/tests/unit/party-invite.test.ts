import { describe, expect, it } from 'vitest'

import { youtube } from '../../src/adapters/sites/youtube'
import { parsePartyFragment, stripPartyFragment } from '../../src/party/invite'
import { parseServerMessage, partySocketUrl } from '../../src/party/protocol'

describe('invite fragment', () => {
  it('reads the party code from the fragment', () => {
    expect(parsePartyFragment('https://www.youtube.com/watch?v=abc#nightreel-party=K7xQ2m')).toBe(
      'K7xQ2m',
    )
    expect(
      parsePartyFragment('https://www.youtube.com/watch?v=abc#t=30&nightreel-party=ab_cd-1'),
    ).toBe('ab_cd-1')
  })

  it('ignores missing, empty or odd-looking codes', () => {
    expect(parsePartyFragment('https://www.youtube.com/watch?v=abc')).toBeNull()
    expect(parsePartyFragment('https://www.youtube.com/watch?v=abc#nightreel-party=')).toBeNull()
    expect(
      parsePartyFragment('https://www.youtube.com/watch?v=abc#nightreel-party=a%3Cb%3E'),
    ).toBeNull()
    expect(
      parsePartyFragment('https://www.youtube.com/watch?v=abc&nightreel-party=K7xQ2m'),
    ).toBeNull()
    expect(parsePartyFragment('not a url')).toBeNull()
  })

  it('strips only the party code', () => {
    expect(stripPartyFragment('https://www.youtube.com/watch?v=abc#nightreel-party=K7xQ2m')).toBe(
      'https://www.youtube.com/watch?v=abc',
    )
    expect(
      stripPartyFragment('https://www.youtube.com/watch?v=abc#t=30&nightreel-party=K7xQ2m'),
    ).toBe('https://www.youtube.com/watch?v=abc#t=30')
    expect(stripPartyFragment('https://www.youtube.com/watch?v=abc#t=30')).toBe(
      'https://www.youtube.com/watch?v=abc#t=30',
    )
  })
})

describe('youtube.watchUrl', () => {
  it('gives the canonical watch URL without timestamps or tracking', () => {
    expect(youtube.watchUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s&list=PL1')).toBe(
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    )
    expect(youtube.watchUrl(new URL('https://www.youtube.com/watch?v=dQw4w9WgXcQ#x'))).toBe(
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    )
    const doc = { location: { href: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' } } as Document
    expect(youtube.watchUrl(doc)).toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ')
  })

  it('is null off the player or for a bad id', () => {
    expect(youtube.watchUrl('https://www.youtube.com/feed/subscriptions')).toBeNull()
    expect(youtube.watchUrl('https://www.youtube.com/watch')).toBeNull()
    expect(youtube.watchUrl('https://www.youtube.com/watch?v=<script>')).toBeNull()
    expect(youtube.watchUrl('https://evil.example/watch?v=dQw4w9WgXcQ')).toBeNull()
  })
})

describe('party socket protocol', () => {
  it('builds the socket URL from the API URL', () => {
    expect(partySocketUrl('http://localhost:8000', 'K7xQ2m')).toBe(
      'ws://localhost:8000/api/v1/parties/K7xQ2m/ws',
    )
    expect(partySocketUrl('https://api.nightreel.app/', 'K7xQ2m')).toBe(
      'wss://api.nightreel.app/api/v1/parties/K7xQ2m/ws',
    )
  })

  it('parses server frames and rejects malformed ones', () => {
    const state = { paused: true, position: 3, rate: 1, updated_at: 10, seq: 2, by: null }
    expect(parseServerMessage(JSON.stringify({ type: 'state', state }))).toEqual({
      type: 'state',
      state,
    })
    expect(
      parseServerMessage(
        JSON.stringify({
          type: 'welcome',
          state,
          members: 2,
          you: { id: 'u', display_name: 'Kai' },
        }),
      ),
    ).toMatchObject({ type: 'welcome', members: 2 })
    expect(parseServerMessage(JSON.stringify({ type: 'members', count: 3 }))).toEqual({
      type: 'members',
      count: 3,
    })
    expect(parseServerMessage('{"type":"state","state":{"paused":"no"}}')).toBeNull()
    expect(parseServerMessage('{"type":"members"}')).toBeNull()
    expect(parseServerMessage('{"type":"surprise"}')).toBeNull()
    expect(parseServerMessage('not json')).toBeNull()
    expect(parseServerMessage(42)).toBeNull()
  })
})
