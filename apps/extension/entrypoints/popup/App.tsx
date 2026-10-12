import { Avatar, Button, Skeleton } from '@nightreel/ui'
import { useEffect, useState } from 'react'

import { ContinueWatchingList } from '../../src/features/continue-watching/ContinueWatchingList'
import { PartyPanel } from '../../src/features/party/PartyPanel'
import { NoProfiles, ProfileSwitcher } from '../../src/features/profiles/ProfileSwitcher'
import { SignInPanel } from '../../src/features/session/SignInPanel'
import { StreakLine } from '../../src/features/streaks/StreakLine'
import { env } from '../../src/lib/env'
import { failureMessage } from '../../src/lib/result'
import type { Profile } from '../../src/lib/types'
import { onBroadcast, send, type SessionState } from '../../src/messaging/protocol'
import { useAsync } from '../../src/messaging/useAsync'

export function App() {
  const [session, reload] = useAsync(() => send({ type: 'session:get' }), [])
  const [override, setOverride] = useState<SessionState | null>(null)

  useEffect(
    () =>
      onBroadcast((message) => {
        if (message.type === 'session:changed') {
          setOverride(null)
          reload()
        }
      }),
    [reload],
  )

  const current = override ?? (session.status === 'done' ? session.data : null)

  if (session.status === 'error') {
    return (
      <main className="nr-popup">
        <Header />
        <p className="nr-popup__error">{failureMessage('rejected')}</p>
      </main>
    )
  }
  if (!current) {
    return (
      <main className="nr-popup" aria-busy="true">
        <Header />
        <Skeleton shape="text" width="50%" />
        <Skeleton shape="rect" height={64} />
      </main>
    )
  }
  if (!current.signedIn) {
    return (
      <main className="nr-popup">
        <Header />
        <SignInPanel onSignedIn={setOverride} />
      </main>
    )
  }
  return (
    <SignedIn
      onSignedOut={() => {
        setOverride({ signedIn: false, displayName: null })
      }}
    />
  )
}

function Header({ profile }: { profile?: Profile | null }) {
  return (
    <header className="nr-popup__header">
      <span className="nr-wordmark">
        nightreel<span className="nr-wordmark__dot">.</span>
      </span>
      {profile ? <Avatar name={profile.name} color={profile.avatar_color} size="sm" /> : null}
    </header>
  )
}

function SignedIn({ onSignedOut }: { onSignedOut: () => void }) {
  const [profiles, reloadProfiles] = useAsync(() => send({ type: 'profiles:list' }), [])
  const [signingOut, setSigningOut] = useState(false)

  const listed = profiles.status === 'done' && profiles.data.ok ? profiles.data.data : null
  const activeProfileId = listed?.activeProfileId ?? null
  const active = listed?.profiles.find((p) => p.id === activeProfileId) ?? null

  async function signOut() {
    setSigningOut(true)
    await send({ type: 'session:sign-out' }).catch(() => undefined)
    onSignedOut()
  }

  async function select(profileId: string) {
    await send({ type: 'profile:set', profileId }).catch(() => undefined)
    reloadProfiles()
  }

  let body
  if (profiles.status === 'loading') {
    body = (
      <div aria-busy="true" aria-label="Loading profiles">
        <Skeleton shape="rect" height={32} />
      </div>
    )
  } else if (!listed) {
    const error = profiles.status === 'done' && !profiles.data.ok ? profiles.data.error : 'rejected'
    body = <p className="nr-popup__error">{failureMessage(error)}</p>
  } else if (listed.profiles.length === 0 || !activeProfileId) {
    body = <NoProfiles webUrl={env.webUrl} />
  } else {
    body = (
      <>
        {listed.profiles.length > 1 ? (
          <ProfileSwitcher
            profiles={listed.profiles}
            activeProfileId={activeProfileId}
            onSelect={(id) => void select(id)}
          />
        ) : null}
        <Activity profileId={activeProfileId} />
      </>
    )
  }

  return (
    <main className="nr-popup">
      <Header profile={active} />
      <PartyPanel />
      {body}
      <footer className="nr-popup__footer">
        <a href={env.webUrl} target="_blank" rel="noreferrer">
          Open Nightreel
        </a>
        <Button size="sm" variant="ghost" loading={signingOut} onClick={() => void signOut()}>
          Sign out
        </Button>
      </footer>
    </main>
  )
}

/** Continue watching and the streak line for the active profile. */
function Activity({ profileId }: { profileId: string }) {
  const [history] = useAsync(() => send({ type: 'history:continue' }), [profileId])
  const [streak] = useAsync(() => send({ type: 'streak:get' }), [profileId])
  const episodesToday =
    streak.status === 'done' && streak.data.ok ? streak.data.data.episodes_today : 0

  return (
    <section className="nr-popup__section" aria-labelledby="cw-title">
      <h1 id="cw-title" className="nr-popup__title">
        Continue watching
      </h1>
      <StreakLine episodesToday={episodesToday} />
      <ContinueWatchingList state={history} />
    </section>
  )
}
