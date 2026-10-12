import { Avatar } from '@nightreel/ui'

import type { Profile } from '../../lib/types'

interface Props {
  profiles: Profile[]
  activeProfileId: string | null
  onSelect: (profileId: string) => void
}

/** Pick who is watching. Each profile is a toggle button; the active one is pressed. */
export function ProfileSwitcher({ profiles, activeProfileId, onSelect }: Props) {
  return (
    <section className="nr-popup__section" aria-labelledby="profiles-title">
      <h2 id="profiles-title" className="nr-visually-hidden">
        Who is watching
      </h2>
      <ul className="nr-profiles">
        {profiles.map((profile) => (
          <li key={profile.id}>
            <button
              type="button"
              className="nr-profiles__option"
              aria-pressed={profile.id === activeProfileId}
              onClick={() => onSelect(profile.id)}
            >
              <Avatar name={profile.name} color={profile.avatar_color} size="sm" decorative />
              {profile.name}
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}

export function NoProfiles({ webUrl }: { webUrl: string }) {
  return (
    <p className="nr-popup__muted">
      You have no profiles yet.{' '}
      <a href={`${webUrl}/profiles`} target="_blank" rel="noreferrer">
        Create one on Nightreel
      </a>{' '}
      to start syncing.
    </p>
  )
}
