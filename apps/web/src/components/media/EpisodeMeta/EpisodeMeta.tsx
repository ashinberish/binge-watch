import { episodeLabel, formatDuration, timeLeft } from '@nightreel/shared'
import './EpisodeMeta.css'

export interface EpisodeMetaProps {
  season: number
  episode: number
  episodeTitle?: string | null
  positionSeconds?: number | null
  durationSeconds?: number | null
}

/** "S2 · E5 · Title · 18 min left" — falls back to the runtime when nothing is watched yet. */
export function EpisodeMeta({
  season,
  episode,
  episodeTitle,
  positionSeconds,
  durationSeconds,
}: EpisodeMetaProps) {
  const parts = [episodeLabel(season, episode)]
  if (episodeTitle) parts.push(episodeTitle)
  if (durationSeconds && durationSeconds > 0) {
    parts.push(
      positionSeconds && positionSeconds > 0
        ? timeLeft(positionSeconds, durationSeconds)
        : formatDuration(durationSeconds),
    )
  }
  return <span className="nr-episode-meta">{parts.join(' · ')}</span>
}
