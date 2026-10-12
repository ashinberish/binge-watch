import { Icon, Skeleton } from '@nightreel/ui'
import type { ProfileId } from '@/lib/api'
import { useStreak } from '../api/streaks-api'
import { streakCopy } from '../copy'
import './StreakBanner.css'

export interface StreakBannerProps {
  profileId: ProfileId
}

export function StreakBanner({ profileId }: StreakBannerProps) {
  const streak = useStreak(profileId)

  if (streak.isPending) {
    return (
      <div className="nr-streak" role="status" aria-label="Loading your streak">
        <Skeleton shape="text" width="60%" />
      </div>
    )
  }
  // A missing streak is not worth an error state on the history page.
  if (streak.isError) return null

  const copy = streakCopy(streak.data)
  return (
    <section className="nr-streak" aria-label="Your streak">
      <span className="nr-streak__icon">
        <Icon icon="flame" />
      </span>
      <div className="nr-streak__text">
        <p className="nr-streak__headline">{copy.headline}</p>
        <p className="nr-streak__detail">{copy.detail}</p>
      </div>
      <p className="nr-streak__count" aria-hidden="true">
        {streak.data.current_days}
      </p>
    </section>
  )
}
