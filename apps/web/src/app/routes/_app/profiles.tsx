import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { PageHeader } from '@/components/layout'
import { ProfilePicker } from '@/features/profiles'
import { useUiStore } from '@/stores/ui'

export const Route = createFileRoute('/_app/profiles')({
  component: ProfilesPage,
})

function ProfilesPage() {
  const navigate = useNavigate()
  const setActiveProfile = useUiStore((s) => s.setActiveProfile)
  return (
    <>
      <PageHeader display title="Who's watching?" />
      <ProfilePicker
        onSelect={(profile) => {
          setActiveProfile(profile.id)
          void navigate({ to: '/history' })
        }}
      />
    </>
  )
}
