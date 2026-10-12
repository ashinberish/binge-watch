import { http, HttpResponse } from 'msw'
import { beforeEach, describe, expect, it } from 'vitest'
import { API, tokenPair } from '@/test/fixtures'
import { server } from '@/test/server'
import { ensureSession, refreshSession, useSession } from './session'

describe('session', () => {
  beforeEach(() => useSession.getState().clear())

  it('keeps the access token in memory and the refresh token in storage', () => {
    useSession.getState().setTokens(tokenPair)
    expect(useSession.getState().accessToken).toBe('access-1')
    expect(localStorage.getItem('nightreel.refresh_token')).toBe('refresh-1')
    expect(JSON.stringify(localStorage)).not.toContain('access-1')
  })

  it('restores a session from the refresh token, sharing one request', async () => {
    localStorage.setItem('nightreel.refresh_token', 'refresh-1')
    let calls = 0
    server.use(
      http.post(`${API}/auth/refresh`, () => {
        calls += 1
        return HttpResponse.json({ ...tokenPair, access_token: 'access-2' })
      }),
    )
    const [a, b] = await Promise.all([refreshSession(), refreshSession()])
    expect(a && b).toBe(true)
    expect(calls).toBe(1)
    expect(useSession.getState().accessToken).toBe('access-2')
  })

  it('clears the session when refresh is rejected', async () => {
    localStorage.setItem('nightreel.refresh_token', 'stale')
    server.use(http.post(`${API}/auth/refresh`, () => new HttpResponse(null, { status: 401 })))
    expect(await ensureSession()).toBe(false)
    expect(localStorage.getItem('nightreel.refresh_token')).toBeNull()
  })

  it('is signed out without any token', async () => {
    expect(await ensureSession()).toBe(false)
  })
})
