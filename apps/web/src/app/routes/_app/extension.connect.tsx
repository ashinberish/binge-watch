import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { useMe } from '@/features/auth'
import { ConnectExtensionCard } from '@/features/extension-connect'

// Shape only; the card validates the value itself and never redirects to an invalid one.
const searchSchema = z.object({ redirect_uri: z.string().optional().catch(undefined) })

export const Route = createFileRoute('/_app/extension/connect')({
  validateSearch: searchSchema,
  component: ConnectExtensionPage,
})

function ConnectExtensionPage() {
  const { redirect_uri: redirectUri } = Route.useSearch()
  const me = useMe()
  return (
    <div style={{ maxWidth: 480, margin: '0 auto', width: '100%' }}>
      <ConnectExtensionCard redirectUri={redirectUri} displayName={me.data?.display_name} />
    </div>
  )
}
