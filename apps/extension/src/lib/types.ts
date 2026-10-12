import type { components } from '@nightreel/api-client'

type Schemas = components['schemas']

export type TokenPair = Schemas['TokenPair']
export type UserRead = Schemas['UserRead']
export type Profile = Schemas['ProfileRead']
export type Streak = Schemas['StreakRead']
export type ShowDetail = Schemas['ShowDetail']

export type NextEpisode = Schemas['NextEpisode']
export type MatchResult = Schemas['MatchResult']

/**
 * One row of GET /api/v1/history (the active profile's watch history, newest first).
 * Kept structural so the generated type is assignable to it.
 */
export interface HistoryItem {
  episode_id: string
  show_id: string
  show_title: string
  poster_url: string | null
  season_number: number
  episode_number: number
  episode_title: string | null
  position_seconds: number
  duration_seconds: number
  /** ISO 8601. */
  updated_at: string
  completed: boolean
}
