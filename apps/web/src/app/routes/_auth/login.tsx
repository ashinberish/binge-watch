import { Card } from '@nightreel/ui'
import { createFileRoute, Link, useRouter } from '@tanstack/react-router'
import { z } from 'zod'
import { LoginForm } from '@/features/auth'

const searchSchema = z.object({ redirect: z.string().optional() })

/** Only same-origin paths; never follow a redirect to another site. */
function safeRedirect(target: string | undefined): string {
  return target && target.startsWith('/') && !target.startsWith('//') ? target : '/profiles'
}

export const Route = createFileRoute('/_auth/login')({
  validateSearch: searchSchema,
  component: LoginPage,
})

function LoginPage() {
  const { redirect } = Route.useSearch()
  const router = useRouter()
  return (
    <>
      <h1 className="nr-auth__title">Sign in</h1>
      <Card padding="lg">
        <LoginForm onSuccess={() => router.history.push(safeRedirect(redirect))} />
      </Card>
      <p className="nr-auth__switch">
        New to Nightreel? <Link to="/register">Create an account</Link>
      </p>
    </>
  )
}
