import { describe, expect, it } from 'vitest'
import { partyWatchLink, providerName } from './watch-link'

describe('partyWatchLink', () => {
  it('adds the invite to the fragment of an https watch URL', () => {
    expect(partyWatchLink('https://www.youtube.com/watch?v=abc', 'K7xQ2m')).toBe(
      'https://www.youtube.com/watch?v=abc#nightreel-party=K7xQ2m',
    )
    // Any fragment already there is replaced.
    expect(partyWatchLink('https://www.youtube.com/watch?v=abc#t=5', 'a b')).toBe(
      'https://www.youtube.com/watch?v=abc#nightreel-party=a%20b',
    )
  })

  it('refuses anything but plain https', () => {
    expect(partyWatchLink('http://www.youtube.com/watch?v=abc', 'K7xQ2m')).toBeNull()
    expect(partyWatchLink('javascript:alert(1)', 'K7xQ2m')).toBeNull()
    expect(partyWatchLink('https://user:pw@www.youtube.com/', 'K7xQ2m')).toBeNull()
    expect(partyWatchLink('/relative', 'K7xQ2m')).toBeNull()
  })
})

describe('providerName', () => {
  it('names known providers', () => {
    expect(providerName('youtube')).toBe('YouTube')
    expect(providerName('vimeo')).toBe('vimeo')
  })
})
