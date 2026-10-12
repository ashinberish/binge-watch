import { useToast } from '@nightreel/ui'
import { createFileRoute, redirect } from '@tanstack/react-router'
import { PageHeader } from '@/components/layout'
import { ContinueWatchingRow } from '@/features/history'
import { StreakBanner } from '@/features/streaks'
import { useUiStore } from '@/stores/ui'

export const Route = createFileRoute('/_app/history')({
  beforeLoad: () => {
    if (useUiStore.getState().activeProfileId == null) throw redirect({ to: '/profiles' })
  },
  component: HistoryPage,
})

function HistoryPage() {
  const profileId = useUiStore((s) => s.activeProfileId)
  const { toast } = useToast()
  if (profileId == null) return null
  return (
    <>
      <PageHeader title="Pick up where you left off" />
      <div className="nr-stack">
        <StreakBanner profileId={profileId} />
        <ContinueWatchingRow
          profileId={profileId}
          onResume={(item) =>
            toast({
              title: `Resume ${item.show_title}`,
              description:
                'Open it on your streaming service and Nightreel picks up from your last spot.',
            })
          }
        />
      </div>
    </>
  )
}
