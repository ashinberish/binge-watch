import { Button } from '@nightreel/ui'
import { useState } from 'react'

import { failureMessage } from '../../lib/result'
import { send, type SessionState } from '../../messaging/protocol'

interface Props {
  onSignedIn: (session: SessionState) => void
}

export function SignInPanel({ onSignedIn }: Props) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function signIn() {
    setPending(true)
    setError(null)
    try {
      const result = await send({ type: 'session:sign-in' })
      if (result.ok) onSignedIn(result.data)
      else setError(failureMessage(result.error))
    } catch {
      setError(failureMessage('rejected'))
    } finally {
      setPending(false)
    }
  }

  return (
    <section className="nr-popup__signin" aria-labelledby="signin-title">
      <h1 id="signin-title" className="nr-popup__title">
        Connect your account
      </h1>
      <p className="nr-popup__muted">
        Sign in to save your progress as you watch, pick up where you left off and get a countdown
        to the next episode.
      </p>
      {error ? (
        <p className="nr-popup__error" role="alert">
          {error}
        </p>
      ) : null}
      <Button size="sm" variant="primary" loading={pending} onClick={() => void signIn()}>
        Sign in
      </Button>
    </section>
  )
}
