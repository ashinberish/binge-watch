import { describe, expect, it, vi } from 'vitest'

import { fail, ok } from '../../src/lib/result'
import { localStore } from '../../src/storage'
import { cachedMatch, lruGet, lruPut, MATCH_CACHE_MAX, matchKey } from '../../src/sync/match-cache'
import { match } from './fixtures'

describe('match cache LRU', () => {
  it('evicts the least recently used entry past the limit', () => {
    let entries: Array<[string, number]> = []
    for (let i = 0; i < 3; i++) entries = lruPut(entries, `k${i}`, i, 3)
    entries = lruGet(entries, 'k0').entries // k0 is now the most recent
    entries = lruPut(entries, 'k3', 3, 3)
    expect(entries.map(([k]) => k)).toEqual(['k2', 'k0', 'k3'])
  })

  it('replaces an existing key without growing', () => {
    const entries = lruPut(lruPut([], 'a', 1), 'a', 2)
    expect(entries).toEqual([['a', 2]])
  })

  it('is bounded at 500 entries by default', () => {
    let entries: Array<[string, number]> = []
    for (let i = 0; i < 520; i++) entries = lruPut(entries, `k${i}`, i)
    expect(MATCH_CACHE_MAX).toBe(500)
    expect(entries).toHaveLength(500)
    expect(entries[0]?.[0]).toBe('k20')
  })

  it('reports a miss without reordering', () => {
    const entries: Array<[string, number]> = [['a', 1]]
    expect(lruGet(entries, 'b')).toEqual({ value: undefined, entries })
  })
})

describe('cachedMatch', () => {
  it('asks the API once per provider and external id', async () => {
    const fetcher = vi.fn(async () => ok(match('e1')))
    const key = matchKey('youtube', 'abc')
    expect(key).toBe('youtube:abc')
    await cachedMatch(key, fetcher)
    const second = await cachedMatch(key, fetcher)
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(second).toEqual(ok(match('e1')))
    expect((await localStore.get()).matchCache).toHaveLength(1)
  })

  it('does not cache failures', async () => {
    const fetcher = vi.fn(async () => fail<never>('network'))
    await cachedMatch('youtube:x', fetcher)
    await cachedMatch('youtube:x', fetcher)
    expect(fetcher).toHaveBeenCalledTimes(2)
  })
})
