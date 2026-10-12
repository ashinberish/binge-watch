import { describe, expect, it, vi } from 'vitest'

import { fail, ok } from '../../src/lib/result'
import { localStore, type QueuedProgress } from '../../src/storage'
import { createFlushScheduler, enqueue, flush, push, type FlushDeps } from '../../src/sync/queue'
import { item, match } from './fixtures'

describe('enqueue', () => {
  it('keeps only the newest snapshot per episode', () => {
    const queue = enqueue([item('a', 10), item('b', 20)], item('a', 30))
    expect(queue.map((q) => [q.snapshot.externalId, q.snapshot.positionSeconds])).toEqual([
      ['b', 20],
      ['a', 30],
    ])
  })

  it('caps the queue at 200 entries', () => {
    let queue: QueuedProgress[] = []
    for (let i = 0; i < 250; i++) queue = enqueue(queue, item(`ep-${i}`, i))
    expect(queue).toHaveLength(200)
    expect(queue[0]?.snapshot.externalId).toBe('ep-50')
  })
})

function deps(overrides: Partial<FlushDeps> = {}): FlushDeps {
  return {
    isSignedIn: async () => true,
    activeProfileId: async () => 'profile-1',
    match: async (q) => ok(match(`ep-${q.snapshot.externalId}`)),
    putProgress: async () => ok({}),
    ...overrides,
  }
}

const queued = async () => (await localStore.get()).syncQueue?.map((q) => q.snapshot.externalId)

describe('flush', () => {
  it('removes items once their progress is saved', async () => {
    await push(item('a', 120))
    await push(item('b', 240))
    const putProgress = vi.fn(async () => ok({}))
    const report = await flush(deps({ putProgress }))
    expect(report).toMatchObject({ synced: 2, dropped: 0, kept: 0 })
    expect(putProgress).toHaveBeenCalledWith('ep-a', 'profile-1', 120, 3000)
    expect(await queued()).toEqual([])
  })

  it('uses the profile that was active when the snapshot was taken', async () => {
    await push({ ...item('a'), profileId: 'profile-2' })
    const putProgress = vi.fn(async () => ok({}))
    await flush(deps({ putProgress }))
    expect(putProgress).toHaveBeenCalledWith('ep-a', 'profile-2', 60, 3000)
  })

  it('keeps everything on a network error and stops trying', async () => {
    await push(item('a'))
    await push(item('b'))
    const putProgress = vi.fn(async () => fail('network'))
    const report = await flush(deps({ putProgress }))
    expect(report).toMatchObject({ synced: 0, kept: 2 })
    expect(putProgress).toHaveBeenCalledTimes(1)
    expect(await queued()).toEqual(['a', 'b'])
  })

  it('keeps items when matching hits a network error', async () => {
    await push(item('a'))
    await flush(deps({ match: async () => fail('network') }))
    expect(await queued()).toEqual(['a'])
  })

  it('keeps items on 5xx and 401, drops them on other 4xx', async () => {
    await push(item('server'))
    await push(item('bad'))
    await push(item('gone'))
    const putProgress = vi.fn(async (episodeId: string) =>
      episodeId === 'ep-server'
        ? fail('server')
        : episodeId === 'ep-bad'
          ? fail('rejected')
          : fail('not-found'),
    )
    const report = await flush(deps({ putProgress }))
    expect(report).toMatchObject({ synced: 0, dropped: 2, kept: 1 })
    expect(await queued()).toEqual(['server'])

    await flush(deps({ putProgress: async () => fail('signed-out') }))
    expect(await queued()).toEqual(['server'])
  })

  it('skips without a session', async () => {
    await push(item('a'))
    const m = vi.fn()
    const report = await flush(deps({ isSignedIn: async () => false, match: m }))
    expect(report.skipped).toBe('signed-out')
    expect(m).not.toHaveBeenCalled()
    expect(await queued()).toEqual(['a'])
  })

  it('skips without an active profile', async () => {
    await push(item('a'))
    const m = vi.fn()
    const report = await flush(deps({ activeProfileId: async () => null, match: m }))
    expect(report.skipped).toBe('no-profile')
    expect(m).not.toHaveBeenCalled()
    expect(await queued()).toEqual(['a'])
  })

  it('keeps a newer snapshot queued while the flush was running', async () => {
    await push(item('a', 10, 1))
    const putProgress = vi.fn(async () => {
      await push(item('a', 99, 2))
      return ok({})
    })
    await flush(deps({ putProgress }))
    const { syncQueue } = await localStore.get()
    expect(syncQueue?.map((q) => q.snapshot.positionSeconds)).toEqual([99])
  })
})

describe('createFlushScheduler', () => {
  it('debounces bursts into one run', async () => {
    vi.useFakeTimers()
    const task = vi.fn(async () => undefined)
    const scheduler = createFlushScheduler(task, 2000)
    scheduler.soon()
    scheduler.soon()
    scheduler.soon()
    await vi.advanceTimersByTimeAsync(2000)
    expect(task).toHaveBeenCalledTimes(1)
    vi.useRealTimers()
  })

  it('never runs two flushes at once and reruns once if asked mid-run', async () => {
    let release!: () => void
    let active = 0
    let maxActive = 0
    const task = vi.fn(async () => {
      active += 1
      maxActive = Math.max(maxActive, active)
      await new Promise<void>((r) => (release = r))
      active -= 1
    })
    const scheduler = createFlushScheduler(task)
    const first = scheduler.now()
    void scheduler.now()
    void scheduler.now()
    release()
    await vi.waitFor(() => expect(task).toHaveBeenCalledTimes(2))
    release()
    await first
    expect(maxActive).toBe(1)
  })
})
