import { episodeLabel, formatDuration } from '@nightreel/shared'

import type { ShowDetail } from '../../lib/types'

interface Props {
  show: ShowDetail
  currentEpisodeId: string
}

/** Every season's episodes, with the one playing in the tab marked as current. */
export function EpisodeList({ show, currentEpisodeId }: Props) {
  return (
    <div className="nr-popup__section">
      {show.seasons.map((season) => (
        <section key={season.id} aria-labelledby={`season-${season.id}`} className="nr-season">
          <h2 id={`season-${season.id}`} className="nr-season__title">
            Season {season.number}
          </h2>
          <ol className="nr-episodes">
            {season.episodes.map((episode) => {
              const current = episode.id === currentEpisodeId
              return (
                <li
                  key={episode.id}
                  className="nr-episodes__item"
                  aria-current={current ? 'true' : undefined}
                >
                  <span className="nr-episodes__label">
                    {episodeLabel(season.number, episode.number)}
                  </span>
                  <span className="nr-episodes__title">
                    {episode.title}
                    {current ? <span className="nr-visually-hidden"> (playing now)</span> : null}
                  </span>
                  <span className="nr-episodes__meta">
                    {formatDuration(episode.duration_seconds)}
                  </span>
                </li>
              )
            })}
          </ol>
        </section>
      ))}
    </div>
  )
}
