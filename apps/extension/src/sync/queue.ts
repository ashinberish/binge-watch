import type { Failure, Result } from '../lib/result'
import type { MatchResult } from '../lib/types'
import { localStore, serialized, type QueuedProgress } from '../storage'

const MAX_QUEUE = 200

const itemKey = (item: QueuedProgress) => `${item.adapter}:${item.snapshot.externalId}`

/** Keeps only the newest snapshot per episode, capped so storage can't grow unbounded. */
export function enqueue(queue: QueuedProgress[], item: QueuedProgress): QueuedProgress[] {
  const rest = queue.filter((q) => itemKey(q) !== itemKey(item))
  return [...rest, item].slice(-MAX_QUEUE)
}

/** Removes exactly these snapshots; a newer one for the same episode queued meanwhile stays. */
export function without(queue: QueuedProgress[], done: QueuedProgress[]): QueuedProgress[] {
  const gone = new Set(done.map((d) => `${itemKey(d)}@${d.queuedAt}`))
  return queue.filter((q) => !gone.has(`${itemKey(q)}@${q.queuedAt}`))
}

export function push(item: QueuedProgress): Promise<void> {
  return serialized(async () => {
    const { syncQueue = [] } = await localStore.get()
    await localStore.set({ syncQueue: enqueue(syncQueue, item) })
  })
}

export function clearQueue(): Promise<void> {
  return serialized(() => localStore.remove(['syncQueue']))
}

function removeFromQueue(done: QueuedProgress[]): Promise<void> {
  if (done.length === 0) return Promise.resolve()
  return serialized(async () => {
    const { syncQueue = [] } = await localStore.get()
    await localStore.set({ syncQueue: without(syncQueue, done) })
  })
}

export interface FlushDeps {
  isSignedIn(): Promise<boolean>
  activeProfileId(): Promise<string | null>
  /** Resolves the snapshot's external id to a catalog episode (cached). */
  match(item: QueuedProgress): Promise<Result<MatchResult>>
  putProgress(
    episodeId: string,
    profileId: string,
    positionSeconds: number,
    durationSeconds: number,
  ): Promise<Result<unknown>>
}

export interface FlushReport {
  synced: number
  dropped: number
  kept: number
  skipped?: 'signed-out' | 'no-profile'
}

/** Failures worth retrying on the next flush. Anything else is a request the API will never accept. */
const RETRYABLE: ReadonlySet<Failure> = new Set(['network', 'server', 'signed-out'])
/** Failures that will hit every other item too, so the rest of this flush is skipped. */
const STOP: ReadonlySet<Failure> = new Set(['network', 'signed-out'])

/**
 * Drains the queue to the API: resolve each external id to a catalog episode, then
 * PUT its progress. An item leaves the queue when it is saved or when the API rejects
 * it outright (4xx other than 401); network errors, 5xx and 401 keep it for next time.
 */
export async function flush(deps: FlushDeps): Promise<FlushReport> {
  const { syncQueue = [] } = await localStore.get()
  const report: FlushReport = { synced: 0, dropped: 0, kept: syncQueue.length }
  if (syncQueue.length === 0) return report
  if (!(await deps.isSignedIn())) return { ...report, skipped: 'signed-out' }
  const activeProfileId = await deps.activeProfileId()
  if (!activeProfileId) return { ...report, skipped: 'no-profile' }

  const done: QueuedProgress[] = []
  for (const item of syncQueue) {
    const { positionSeconds, durationSeconds } = item.snapshot
    if (!(durationSeconds > 0)) {
      done.push(item)
      report.dropped += 1
      continue
    }
    const match = await deps.match(item)
    const saved = match.ok
      ? await deps.putProgress(
          match.data.episode_id,
          item.profileId ?? activeProfileId,
          Math.max(0, Math.floor(positionSeconds)),
          Math.floor(durationSeconds),
        )
      : match
    if (saved.ok) {
      done.push(item)
      report.synced += 1
    } else if (!RETRYABLE.has(saved.error)) {
      done.push(item)
      report.dropped += 1
    } else if (STOP.has(saved.error)) {
      break
    }
  }
  report.kept = syncQueue.length - done.length
  await removeFromQueue(done)
  return report
}

/**
 * Runs `task` at most once at a time. `soon()` debounces bursts (snapshots from several
 * tabs) into one run; a request that arrives mid-run schedules one more run after it.
 */
export function createFlushScheduler(task: () => Promise<unknown>, debounceMs = 2_000) {
  let timer: ReturnType<typeof setTimeout> | null = null
  let running: Promise<void> | null = null
  let again = false

  function now(): Promise<void> {
    if (running) {
      again = true
      return running
    }
    running = (async () => {
      try {
        do {
          again = false
          await task().catch(() => undefined)
        } while (again)
      } finally {
        running = null
      }
    })()
    return running
  }

  function soon(): void {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      void now()
    }, debounceMs)
  }

  return { now, soon }
}
