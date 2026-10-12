import { describe, expect, it } from 'vitest'

import { connectUrl, parseCodeFromRedirect } from '../../src/lib/auth-flow'

const REDIRECT = `https://${'a'.repeat(16)}${'p'.repeat(16)}.chromiumapp.org/`

describe('connectUrl', () => {
  it('points at the web app with the redirect encoded', () => {
    expect(connectUrl('http://localhost:5173', REDIRECT)).toBe(
      `http://localhost:5173/extension/connect?redirect_uri=${encodeURIComponent(REDIRECT)}`,
    )
  })
})

describe('parseCodeFromRedirect', () => {
  it('reads the code from the fragment', () => {
    expect(parseCodeFromRedirect(`${REDIRECT}#code=abc-123_XYZ`, REDIRECT)).toBe('abc-123_XYZ')
  })

  it('decodes an encoded code', () => {
    expect(parseCodeFromRedirect(`${REDIRECT}#code=a%2Bb`, REDIRECT)).toBe('a+b')
  })

  it('ignores a missing or empty code', () => {
    expect(parseCodeFromRedirect(undefined, REDIRECT)).toBeNull()
    expect(parseCodeFromRedirect(REDIRECT, REDIRECT)).toBeNull()
    expect(parseCodeFromRedirect(`${REDIRECT}#code=`, REDIRECT)).toBeNull()
    expect(parseCodeFromRedirect(`${REDIRECT}#error=access_denied`, REDIRECT)).toBeNull()
  })

  it('does not read the code from the query string', () => {
    expect(parseCodeFromRedirect(`${REDIRECT}?code=abc`, REDIRECT)).toBeNull()
  })

  it('rejects a URL that is not our redirect', () => {
    const other = `https://${'b'.repeat(32)}.chromiumapp.org/`
    expect(parseCodeFromRedirect(`${other}#code=abc`, REDIRECT)).toBeNull()
    expect(parseCodeFromRedirect('https://evil.example/#code=abc', REDIRECT)).toBeNull()
    expect(parseCodeFromRedirect('not a url', REDIRECT)).toBeNull()
  })

  it('rejects a redirect URI that is not a chromiumapp.org one', () => {
    expect(
      parseCodeFromRedirect('https://evil.example/#code=abc', 'https://evil.example/'),
    ).toBeNull()
  })
})
