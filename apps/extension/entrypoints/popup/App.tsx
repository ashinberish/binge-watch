import { Button } from '@nightreel/ui'
import { useEffect, useState } from 'react'

import { ContinueWatchingList } from '../../src/features/continue-watching/ContinueWatchingList'
import { send, type SessionState } from '../../src/messaging/protocol'

export function App() {
  const [session, setSession] = useState<SessionState | null>(null)

  useEffect(() => {
    void send({ type: 'session:get' }).then(setSession)
  }, [])

  return (
    <main className="nr-popup">
      <header className="nr-popup__header">
        <span className="nr-wordmark">
          nightreel<span className="nr-wordmark__dot">.</span>
        </span>
      </header>
      <h1 className="nr-popup__title">Continue watching</h1>
      {session?.signedIn ? (
        <ContinueWatchingList />
      ) : (
        <div className="nr-popup__signin">
          <p>Sign in to sync your progress across devices.</p>
          <Button
            size="sm"
            variant="primary"
            onClick={() => void send({ type: 'session:sign-in' }).then(setSession)}
          >
            Sign in
          </Button>
        </div>
      )}
    </main>
  )
}
