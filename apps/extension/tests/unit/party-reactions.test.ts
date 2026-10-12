import { describe, expect, it } from 'vitest'

import { createPanelTracker, isPanelReport } from '../../src/background/panels'
import type { Reaction } from '../../src/party/protocol'
import {
  createReactionQueue,
  MAX_FLOATING_REACTIONS,
  REACTION_EMOJI,
  REACTION_LIFETIME_MS,
  reactionButtonLabel,
} from '../../src/party/reactions'

const reaction = (id: string, kind: Reaction['kind'] = 'heart'): Reaction => ({
  id,
  kind,
  user: { id: 'u2', display_name: 'Sam' },
  at: 1,
})

function setup(reduced = false) {
  const clock = { now: 0, reduced }
  const queue = createReactionQueue({ now: () => clock.now, reducedMotion: () => clock.reduced })
  return { clock, queue }
}

describe('reaction queue', () => {
  it('keeps at most 8 on screen, dropping the oldest', () => {
    const { queue } = setup()
    for (let i = 0; i < 12; i += 1) queue.add(reaction(`r${i}`))
    const active = queue.active()
    expect(active).toHaveLength(MAX_FLOATING_REACTIONS)
    expect(active[0]?.id).toBe('r4')
    expect(active.at(-1)).toMatchObject({ id: 'r11', name: 'Sam', kind: 'heart' })
  })

  it('lets each one go after its lifetime', () => {
    const { clock, queue } = setup()
    queue.add(reaction('r1'))
    clock.now = 600
    queue.add(reaction('r2'))
    clock.now = REACTION_LIFETIME_MS - 1
    expect(queue.active().map((r) => r.id)).toEqual(['r1', 'r2'])
    clock.now = REACTION_LIFETIME_MS
    expect(queue.prune()).toBe(true)
    expect(queue.active().map((r) => r.id)).toEqual(['r2'])
    clock.now = 600 + REACTION_LIFETIME_MS
    expect(queue.active()).toEqual([])
  })

  it('ignores duplicates and spreads a burst sideways', () => {
    const { queue } = setup()
    expect(queue.add(reaction('r1'))).toBe(true)
    expect(queue.add(reaction('r1'))).toBe(false)
    queue.add(reaction('r2'))
    const [a, b] = queue.active()
    expect(a?.offset).toBeGreaterThanOrEqual(0)
    expect(a?.offset).toBeLessThan(48)
    expect(a?.offset).not.toBe(b?.offset)
  })

  it('fades in place for viewers who asked for less motion', () => {
    const { clock, queue } = setup(true)
    queue.add(reaction('r1'))
    clock.reduced = false
    queue.add(reaction('r2'))
    expect(queue.active().map((r) => r.motion)).toEqual(['fade', 'float'])
  })

  it('labels the buttons', () => {
    expect(reactionButtonLabel('heart')).toBe('React with heart')
    expect(reactionButtonLabel('wow')).toBe('React with wow')
  })
})

describe('side panel tracker', () => {
  it('knows which tabs open panels show and whether they read the Party tab', () => {
    const panels = createPanelTracker<string>()
    expect(panels.viewFor(7)).toEqual({ open: false, reading: false })
    expect(panels.update('a', { type: 'panel:view', tabId: 7, reading: false })).toEqual([7])
    expect(panels.viewFor(7)).toEqual({ open: true, reading: false })
    expect(panels.update('b', { type: 'panel:view', tabId: 7, reading: true })).toEqual([7])
    expect(panels.viewFor(7)).toEqual({ open: true, reading: true })
    // Switching tabs touches both the old and the new tab.
    expect(panels.update('b', { type: 'panel:view', tabId: 8, reading: true })).toEqual([7, 8])
    expect(panels.viewFor(7)).toEqual({ open: true, reading: false })
    expect(panels.remove('a')).toEqual([7])
    expect(panels.viewFor(7)).toEqual({ open: false, reading: false })
    expect(panels.remove('zzz')).toEqual([])
  })

  it('checks reports from the panel port', () => {
    expect(isPanelReport({ type: 'panel:view', tabId: 3, reading: true })).toBe(true)
    expect(isPanelReport({ type: 'panel:view', tabId: null, reading: false })).toBe(true)
    expect(isPanelReport({ type: 'panel:view', tabId: '3', reading: true })).toBe(false)
    expect(isPanelReport({ type: 'panel:view', tabId: 1.5, reading: true })).toBe(false)
    expect(isPanelReport({ type: 'other', tabId: 3, reading: true })).toBe(false)
    expect(isPanelReport(null)).toBe(false)
  })
})

describe('reaction emoji', () => {
  it('maps every kind to its emoji', () => {
    expect(REACTION_EMOJI).toEqual({
      heart: '❤️',
      laugh: '😂',
      wow: '😮',
      fire: '🔥',
      clap: '👏',
      sad: '😢',
    })
  })
})
