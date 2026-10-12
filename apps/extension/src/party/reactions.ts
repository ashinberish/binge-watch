import type { Reaction, ReactionKind } from './protocol'

/** At most this many reactions float over the player at once; the oldest goes first. */
export const MAX_FLOATING_REACTIONS = 8
/** How long one reaction stays on screen. */
export const REACTION_LIFETIME_MS = 1_200
/** Horizontal spread, in px, so a burst does not stack into one icon. */
const SPREAD_PX = 48

export interface FloatingReaction {
  id: string
  kind: ReactionKind
  name: string
  /** Local epoch ms when it appeared. */
  startedAt: number
  /** Px left of the stage's right edge, stable per id. */
  offset: number
  /** `fade` for viewers who asked for less motion: no travel, opacity only. */
  motion: 'float' | 'fade'
}

/** A small stable hash, so the same reaction always lands in the same spot. */
function spread(id: string): number {
  let hash = 0
  for (let i = 0; i < id.length; i += 1) hash = (hash * 31 + id.charCodeAt(i)) | 0
  return Math.abs(hash) % SPREAD_PX
}

export interface ReactionQueueOptions {
  now: () => number
  reducedMotion: () => boolean
  max?: number
  lifetimeMs?: number
}

/** The reactions on screen over the player: capped, expiring, deduped by id. */
export function createReactionQueue({
  now,
  reducedMotion,
  max = MAX_FLOATING_REACTIONS,
  lifetimeMs = REACTION_LIFETIME_MS,
}: ReactionQueueOptions) {
  let items: FloatingReaction[] = []

  function prune(): boolean {
    const cutoff = now() - lifetimeMs
    const kept = items.filter((item) => item.startedAt > cutoff)
    const changed = kept.length !== items.length
    items = kept
    return changed
  }

  return {
    /** Adds one reaction. False when it was a duplicate. */
    add(reaction: Reaction): boolean {
      prune()
      if (items.some((item) => item.id === reaction.id)) return false
      const item: FloatingReaction = {
        id: reaction.id,
        kind: reaction.kind,
        name: reaction.user.display_name,
        startedAt: now(),
        offset: spread(reaction.id),
        motion: reducedMotion() ? 'fade' : 'float',
      }
      items = [...items, item].slice(-max)
      return true
    },

    /** Drops expired reactions. True when something was removed. */
    prune,

    clear() {
      items = []
    },

    /** What is on screen now, oldest first. */
    active(): FloatingReaction[] {
      prune()
      return items
    },
  }
}

export type ReactionQueue = ReturnType<typeof createReactionQueue>

/** "React with heart" etc., and the word shown in the reaction tooltip. */
export const REACTION_LABELS: Record<ReactionKind, string> = {
  heart: 'heart',
  laugh: 'laugh',
  wow: 'wow',
  fire: 'fire',
  clap: 'clap',
  sad: 'sad',
}

export const reactionButtonLabel = (kind: ReactionKind): string =>
  `React with ${REACTION_LABELS[kind]}`

/** The six reactions as colour emoji, in the side panel, the pill and over the video. */
export const REACTION_EMOJI: Record<ReactionKind, string> = {
  heart: '❤️',
  laugh: '😂',
  wow: '😮',
  fire: '🔥',
  clap: '👏',
  sad: '😢',
}
