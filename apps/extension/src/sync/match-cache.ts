import type { Result } from '../lib/result'
import type { MatchResult } from '../lib/types'
import { localStore, serialized, type MatchCacheEntry } from '../storage'

export const MATCH_CACHE_MAX = 500

export const matchKey = (provider: string, externalId: string) => `${provider}:${externalId}`

type Entries<V> = Array<[string, V]>

/** Looks a key up and marks it most recently used (entries are ordered oldest first). */
export function lruGet<V>(
  entries: Entries<V>,
  key: string,
): { value: V | undefined; entries: Entries<V> } {
  const index = entries.findIndex(([k]) => k === key)
  if (index === -1) return { value: undefined, entries }
  const hit = entries[index]!
  return { value: hit[1], entries: [...entries.slice(0, index), ...entries.slice(index + 1), hit] }
}

/** Inserts or replaces a key as most recently used, evicting the oldest past `max`. */
export function lruPut<V>(
  entries: Entries<V>,
  key: string,
  value: V,
  max = MATCH_CACHE_MAX,
): Entries<V> {
  const rest = entries.filter(([k]) => k !== key)
  return [...rest, [key, value] as [string, V]].slice(-max)
}

export async function readCachedMatch(key: string): Promise<MatchResult | undefined> {
  return serialized(async () => {
    const { matchCache = [] } = await localStore.get()
    const { value, entries } = lruGet<MatchResult>(matchCache, key)
    if (value) await localStore.set({ matchCache: entries as MatchCacheEntry[] })
    return value
  })
}

export async function writeCachedMatch(key: string, value: MatchResult): Promise<void> {
  await serialized(async () => {
    const { matchCache = [] } = await localStore.get()
    await localStore.set({ matchCache: lruPut(matchCache, key, value) as MatchCacheEntry[] })
  })
}

/** Cache-first catalog match: the API is only asked the first time an episode is seen. */
export async function cachedMatch(
  key: string,
  fetchMatch: () => Promise<Result<MatchResult>>,
): Promise<Result<MatchResult>> {
  const cached = await readCachedMatch(key)
  if (cached) return { ok: true, data: cached }
  const fresh = await fetchMatch()
  if (fresh.ok) await writeCachedMatch(key, fresh.data)
  return fresh
}
