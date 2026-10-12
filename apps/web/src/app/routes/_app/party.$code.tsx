import { createFileRoute } from '@tanstack/react-router'
import { PartyInviteCard } from '@/features/party'

// Guarded by _app: signed-out viewers sign in first and come back here.
export const Route = createFileRoute('/_app/party/$code')({
  component: PartyInvitePage,
})

function PartyInvitePage() {
  const { code } = Route.useParams()
  return (
    <div style={{ maxWidth: 480, margin: '0 auto', width: '100%' }}>
      <PartyInviteCard code={code} />
    </div>
  )
}
