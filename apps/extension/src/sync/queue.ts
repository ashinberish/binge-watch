import type { QueuedProgress } from '../storage'
import { localStore } from '../storage'

const MAX_QUEUE = 200

/** Keeps only the newest snapshot per episode, capped so storage can't grow unbounded. */
export function enqueue(queue: QueuedProgress[], item: QueuedProgress): QueuedProgress[] {
  const rest = queue.filter((q) => q.snapshot.externalId !== item.snapshot.externalId)
  return [...rest, item].slice(-MAX_QUEUE)
}

export async function push(item: QueuedProgress) {
  const { syncQueue = [] } = await localStore.get()
  await localStore.set({ syncQueue: enqueue(syncQueue, item) })
}

/**
 * Drains the queue to the API. Progress is keyed by the service's external id
 * until the catalog-matching endpoint lands, so for now the queue only holds.
 */
export async function flush(): Promise<number> {
  const { syncQueue = [] } = await localStore.get()
  // TODO(phase 3): resolve externalId → episode_id and PUT /api/v1/history/{episode_id}/progress
  return syncQueue.length
}
