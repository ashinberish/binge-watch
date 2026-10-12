import {
  Button,
  buttonVariants,
  Card,
  CardBody,
  CardFooter,
  CardHeader,
  Skeleton,
} from '@nightreel/ui'
import { Link } from '@tanstack/react-router'
import { ApiError, errorMessage } from '@/lib/api'
import { useJoinParty, useParty } from '../api/party-api'
import { partyWatchLink, providerName } from '../watch-link'

export interface PartyInviteCardProps {
  /** Party code from the invite link. */
  code: string
  /** Leaves for the streaming site. Defaults to a normal navigation. */
  onOpen?: (url: string) => void
}

const open = (url: string) => window.location.assign(url)

const ENDED = 'This party has ended or the link is wrong.'
const FULL = 'This party is full.'
const BAD_LINK = 'This party’s video link cannot be opened.'

function joinErrorMessage(error: unknown): string {
  if (error instanceof ApiError && error.status === 404) return ENDED
  if (error instanceof ApiError && error.status === 409) return FULL
  return errorMessage(error, 'Could not join the party. Try again.')
}

const backLink = (label: string) => (
  <Link to="/history" className={buttonVariants({ variant: 'secondary' })}>
    {label}
  </Link>
)

/** The landing page of an invite link: who invited you, and a way in. */
export function PartyInviteCard({ code, onOpen = open }: PartyInviteCardProps) {
  const party = useParty(code)
  const join = useJoinParty()

  if (party.isPending) {
    return (
      <Card elevation="raised" padding="lg" aria-busy="true" aria-label="Loading the invite">
        <Skeleton shape="text" width="70%" />
        <Skeleton shape="rect" height={96} />
      </Card>
    )
  }

  if (party.isError) {
    const notFound = party.error instanceof ApiError && party.error.status === 404
    return (
      <Card elevation="raised" padding="lg" aria-labelledby="party-title">
        <CardHeader
          id="party-title"
          title={notFound ? ENDED : 'This invite cannot be opened right now'}
          description={
            notFound ? 'Ask your friend for a new invite link.' : errorMessage(party.error)
          }
        />
        <CardFooter>{backLink('Back to Nightreel')}</CardFooter>
      </Card>
    )
  }

  const { host, provider, watch_url: watchUrl } = party.data
  const canOpen = partyWatchLink(watchUrl, code) !== null

  const joinAndOpen = () =>
    join.mutate(code, {
      onSuccess: (joined) => {
        const link = partyWatchLink(joined.watch_url, code)
        if (link) onOpen(link)
      },
    })

  const problem = !canOpen ? BAD_LINK : join.isError ? joinErrorMessage(join.error) : null

  return (
    <Card elevation="raised" padding="lg" aria-labelledby="party-title">
      <CardHeader
        id="party-title"
        title={`${host.display_name} invited you to a watch party`}
        description={`Watching on ${providerName(provider)}`}
      />
      <CardBody>
        <p style={{ margin: 0 }}>
          Everyone in the party can play, pause and skip, and it happens for the whole group.
        </p>
        <p style={{ margin: 'var(--nr-space-3) 0 0', color: 'var(--nr-color-ink-muted)' }}>
          You need the Nightreel extension for Chrome to sync playback.
        </p>
        {problem ? (
          <p role="alert" style={{ margin: 'var(--nr-space-4) 0 0' }}>
            {problem}
          </p>
        ) : null}
      </CardBody>
      <CardFooter>
        {backLink('Not now')}
        {canOpen ? (
          <Button loading={join.isPending || join.isSuccess} onClick={joinAndOpen}>
            Join and open
          </Button>
        ) : null}
      </CardFooter>
    </Card>
  )
}
