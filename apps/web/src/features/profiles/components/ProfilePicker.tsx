import { MAX_PROFILES } from '@nightreel/shared'
import {
  Avatar,
  Badge,
  Button,
  Dialog,
  DialogContent,
  Icon,
  Skeleton,
  useDisclosure,
} from '@nightreel/ui'
import { EmptyState, ErrorFallback } from '@/components/feedback'
import type { ProfileRead } from '@/lib/api'
import { useProfiles } from '../api/profiles-api'
import { ProfileForm } from './ProfileForm'
import './Profiles.css'

export interface ProfilePickerProps {
  onSelect: (profile: ProfileRead) => void
}

/** "Who's watching?" grid. New accounts start with no profiles. */
export function ProfilePicker({ onSelect }: ProfilePickerProps) {
  const profiles = useProfiles()
  const dialog = useDisclosure()

  const addDialog = (
    <Dialog open={dialog.open} onOpenChange={dialog.setOpen}>
      <DialogContent
        title="Add a profile"
        description="Each profile keeps its own history and streak."
        size="sm"
      >
        <ProfileForm
          onCreated={(profile) => {
            dialog.onClose()
            onSelect(profile)
          }}
          onCancel={dialog.onClose}
        />
      </DialogContent>
    </Dialog>
  )

  if (profiles.isPending) {
    return (
      <div className="nr-profile-grid" role="status" aria-label="Loading profiles">
        {Array.from({ length: 3 }, (_, i) => (
          <Skeleton key={i} shape="rect" width={120} height={120} />
        ))}
      </div>
    )
  }

  if (profiles.isError) {
    return (
      <ErrorFallback
        title="We could not load your profiles"
        onRetry={() => void profiles.refetch()}
      />
    )
  }

  if (profiles.data.length === 0) {
    return (
      <>
        <EmptyState
          icon="users"
          title="Create your first profile"
          description="Profiles keep everyone's history and streaks separate. You can add up to five."
          action={
            <Button icon="plus" onClick={dialog.onOpen}>
              Add profile
            </Button>
          }
        />
        {addDialog}
      </>
    )
  }

  const canAdd = profiles.data.length < MAX_PROFILES

  return (
    <>
      <ul className="nr-profile-grid">
        {profiles.data.map((profile) => (
          <li key={profile.id}>
            <button type="button" className="nr-profile-card" onClick={() => onSelect(profile)}>
              <Avatar
                name={profile.name}
                color={profile.avatar_color ?? undefined}
                size="xl"
                decorative
              />
              <span className="nr-profile-card__name">{profile.name}</span>
              {profile.is_kids ? <Badge>Kids</Badge> : null}
            </button>
          </li>
        ))}
        {canAdd ? (
          <li>
            <button
              type="button"
              className="nr-profile-card nr-profile-card--add"
              onClick={dialog.onOpen}
            >
              <span className="nr-profile-card__add-icon" aria-hidden="true">
                <Icon icon="plus" size={40} />
              </span>
              <span className="nr-profile-card__name">Add profile</span>
            </button>
          </li>
        ) : null}
      </ul>
      {!canAdd ? (
        <p className="nr-profile-grid__note">You have the maximum of {MAX_PROFILES} profiles.</p>
      ) : null}
      {addDialog}
    </>
  )
}
