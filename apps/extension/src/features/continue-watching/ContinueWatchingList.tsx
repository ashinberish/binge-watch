import { episodeLabel, progressRatio, timeLeft } from '@nightreel/shared'
import { Progress, Skeleton } from '@nightreel/ui'

import { failureMessage, type Result } from '../../lib/result'
import type { ContinueWatchingItem } from '../../lib/types'
import type { AsyncState } from '../../messaging/useAsync'
import { EmptyState } from './EmptyState'

interface Props {
  state: AsyncState<Result<ContinueWatchingItem[]>>
}

/**
 * Popup list of what you were watching. Rows are plain text: there are no deep links
 * into the streaming services yet, so nothing here pretends to be clickable.
 */
export function ContinueWatchingList({ state }: Props) {
  if (state.status === 'loading') {
    return (
      <div className="nr-cw" aria-busy="true" aria-label="Loading continue watching">
        {[0, 1, 2].map((i) => (
          <div key={i} className="nr-cw__row">
            <Skeleton shape="text" width="60%" />
            <Skeleton shape="text" width="40%" />
            <Skeleton shape="rect" height={4} />
          </div>
        ))}
      </div>
    )
  }
  if (state.status === 'error' || !state.data.ok) {
    const message = failureMessage(state.data?.ok === false ? state.data.error : 'rejected')
    return <p className="nr-popup__error">{message}</p>
  }
  if (state.data.data.length === 0) return <EmptyState />

  return (
    <ul className="nr-cw">
      {state.data.data.map((item) => {
        const left = timeLeft(item.position_seconds, item.duration_seconds)
        return (
          <li key={item.episode_id} className="nr-cw__row">
            <span className="nr-cw__show">{item.show_title}</span>
            <span className="nr-cw__meta">
              {episodeLabel(item.season_number, item.episode_number)} · {left}
            </span>
            <Progress
              size="sm"
              value={progressRatio(item.position_seconds, item.duration_seconds)}
              label={`${item.show_title} progress`}
              valueText={left}
            />
          </li>
        )
      })}
    </ul>
  )
}
