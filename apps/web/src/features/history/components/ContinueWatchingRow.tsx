import { progressRatio } from '@nightreel/shared'
import { Tile } from '@nightreel/ui'
import { ErrorFallback, EmptyState } from '@/components/feedback'
import { EpisodeMeta, TileRow } from '@/components/media'
import type { ContinueWatchingItem, ProfileId } from '@/lib/api'
import { useContinueWatching } from '../api/history-api'

export interface ContinueWatchingRowProps {
  profileId: ProfileId
  onResume?: (item: ContinueWatchingItem) => void
}

export function ContinueWatchingRow({ profileId, onResume }: ContinueWatchingRowProps) {
  const query = useContinueWatching(profileId)

  if (query.isError) {
    return (
      <ErrorFallback
        title="We could not load what you were watching"
        onRetry={() => void query.refetch()}
      />
    )
  }

  return (
    <TileRow
      title="Continue watching"
      loading={query.isPending}
      empty={
        <EmptyState
          headingLevel={3}
          icon="tv"
          title="Nothing in progress"
          description="Start an episode with the Nightreel extension on and it will show up here."
        />
      }
    >
      {query.data?.map((item) => (
        <Tile
          key={item.episode_id}
          title={item.show_title}
          art={item.poster_url}
          progress={progressRatio(item.position_seconds, item.duration_seconds)}
          aria-label={`Resume ${item.show_title}`}
          meta={
            <EpisodeMeta
              season={item.season_number}
              episode={item.episode_number}
              positionSeconds={item.position_seconds}
              durationSeconds={item.duration_seconds}
            />
          }
          onClick={() => onResume?.(item)}
        />
      ))}
    </TileRow>
  )
}
