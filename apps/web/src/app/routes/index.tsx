import { createFileRoute, redirect } from '@tanstack/react-router'

// The _app guard sends signed-out visitors to /login and profile-less viewers to /profiles.
export const Route = createFileRoute('/')({
  beforeLoad: () => {
    throw redirect({ to: '/history' })
  },
})
