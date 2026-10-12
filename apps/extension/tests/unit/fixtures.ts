import type { MatchResult } from '../../src/lib/types'
import type { PlaybackState } from '../../src/party/protocol'
import type { QueuedProgress } from '../../src/storage'

export const item = (id: string, position = 60, queuedAt = 1): QueuedProgress => ({
  adapter: 'youtube',
  queuedAt,
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

export const match = (episodeId: string, next = true): MatchResult => ({
  episode_id: episodeId,
  show_id: 'show-1',
  show_title: 'Harbor Lights',
  poster_url: null,
  season_number: 1,
  episode_number: 2,
  episode_title: 'Low tide',
  duration_seconds: 3000,
  next_episode: next
    ? {
        episode_id: `${episodeId}-next`,
        season_number: 1,
        episode_number: 3,
        title: 'High tide',
        duration_seconds: 3000,
      }
    : null,
})

/** A room state: playing from 100 s, set at server time 1000 s. */
export const playbackState = (overrides: Partial<PlaybackState> = {}): PlaybackState => ({
  paused: false,
  position: 100,
  rate: 1,
  updated_at: 1_000,
  seq: 1,
  by: null,
  ...overrides,
})
