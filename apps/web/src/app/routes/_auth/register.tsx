import { Card } from '@nightreel/ui'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { RegisterForm } from '@/features/auth'

export const Route = createFileRoute('/_auth/register')({
  component: RegisterPage,
})

function RegisterPage() {
  const navigate = useNavigate()
  return (
    <>
      <h1 className="nr-auth__title">Create your account</h1>
      <Card padding="lg">
        {/* New accounts have no profiles yet; the picker walks you through the first one. */}
        <RegisterForm onSuccess={() => void navigate({ to: '/profiles' })} />
      </Card>
      <p className="nr-auth__switch">
        Already have an account? <Link to="/login">Sign in</Link>
      </p>
    </>
  )
}
