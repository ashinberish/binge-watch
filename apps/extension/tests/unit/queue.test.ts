import { describe, expect, it } from 'vitest'

import type { QueuedProgress } from '../../src/storage'
import { enqueue } from '../../src/sync/queue'

const item = (id: string, position: number): QueuedProgress => ({
  adapter: 'youtube',
  queuedAt: position,
  snapshot: {
    externalId: id,
    showTitle: 'Harbor Lights',
    episodeTitle: null,
    season: 2,
    episode: 5,
    positionSeconds: position,
    durationSeconds: 3000,
  },
})

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
