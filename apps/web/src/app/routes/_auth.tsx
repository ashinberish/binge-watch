import { createFileRoute, Outlet, redirect } from '@tanstack/react-router'
import { Wordmark } from '@/components/layout'
import { ensureSession } from '@/features/auth'

export const Route = createFileRoute('/_auth')({
  beforeLoad: async () => {
    if (await ensureSession()) throw redirect({ to: '/profiles' })
  },
  component: AuthLayout,
})

function AuthLayout() {
  return (
    <main className="nr-auth">
      <div className="nr-auth__panel">
        <div className="nr-auth__brand">
          <Wordmark />
        </div>
        <Outlet />
      </div>
    </main>
  )
}
