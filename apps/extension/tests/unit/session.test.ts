import { describe, expect, it, vi } from 'vitest'

import { createSession, type RefreshOutcome, type TokenStorage } from '../../src/lib/session'
import type { TokenPair } from '../../src/lib/types'

const pair = (n: number): TokenPair => ({
  access_token: `access-${n}`,
  refresh_token: `refresh-${n}`,
  token_type: 'bearer',
  expires_in: 900,
})

function memoryStorage(initial: { accessToken: string | null; refreshToken: string | null }) {
  const state = { ...initial }
  const storage: TokenStorage = {
    read: async () => ({ ...state }),
    write: async (p) => {
      state.accessToken = p.access_token
      state.refreshToken = p.refresh_token
    },
    clear: async () => {
      state.accessToken = null
      state.refreshToken = null
    },
  }
  return { state, storage }
}

describe('session refresh', () => {
  it('shares one refresh between concurrent callers and stores the rotated token', async () => {
    const { state, storage } = memoryStorage({ accessToken: 'access-1', refreshToken: 'refresh-1' })
    let resolve!: (o: RefreshOutcome) => void
    const refresh = vi.fn(() => new Promise<RefreshOutcome>((r) => (resolve = r)))
    const session = createSession({ storage, refresh })
    await session.load()

    const calls = [session.refresh(), session.refresh(), session.refresh()]
    await vi.waitFor(() => expect(refresh).toHaveBeenCalledTimes(1))
    resolve({ kind: 'ok', pair: pair(2) })
    expect(await Promise.all(calls)).toEqual([true, true, true])
    expect(refresh).toHaveBeenCalledWith('refresh-1')
    expect(session.getAccessToken()).toBe('access-2')
    expect(state.refreshToken).toBe('refresh-2')

    // A later refresh starts a new request with the rotated token.
    refresh.mockResolvedValueOnce({ kind: 'ok', pair: pair(3) })
    await session.refresh()
    expect(refresh).toHaveBeenLastCalledWith('refresh-2')
  })

  it('clears the session when the refresh is rejected', async () => {
    const { state, storage } = memoryStorage({ accessToken: 'a', refreshToken: 'r' })
    const onExpired = vi.fn()
    const session = createSession({
      storage,
      refresh: async () => ({ kind: 'rejected' }),
      onExpired,
    })
    await session.load()
    expect(await session.refresh()).toBe(false)
    expect(session.getAccessToken()).toBeNull()
    expect(state.refreshToken).toBeNull()
    expect(await session.isSignedIn()).toBe(false)
    expect(onExpired).toHaveBeenCalledOnce()
  })

  it('keeps the refresh token on a transient failure', async () => {
    const { state, storage } = memoryStorage({ accessToken: 'a', refreshToken: 'r' })
    const session = createSession({ storage, refresh: async () => ({ kind: 'transient' }) })
    expect(await session.refresh()).toBe(false)
    expect(state.refreshToken).toBe('r')
    expect(await session.isSignedIn()).toBe(true)
  })

  it('does nothing without a refresh token', async () => {
    const { storage } = memoryStorage({ accessToken: null, refreshToken: null })
    const refresh = vi.fn()
    const session = createSession({ storage, refresh })
    expect(await session.refresh()).toBe(false)
    expect(refresh).not.toHaveBeenCalled()
  })

  it('reloads the access token from storage when the worker wakes', async () => {
    const { storage } = memoryStorage({ accessToken: 'stored', refreshToken: 'r' })
    const session = createSession({ storage, refresh: vi.fn() })
    expect(session.getAccessToken()).toBeNull()
    await session.load()
    expect(session.getAccessToken()).toBe('stored')
  })
})
