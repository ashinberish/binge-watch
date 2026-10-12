import {
  Avatar,
  IconButton,
  Menu,
  MenuContent,
  MenuItem,
  MenuLabel,
  MenuSeparator,
  MenuTrigger,
} from '@nightreel/ui'
import { createFileRoute, Outlet, redirect, useMatches, useNavigate } from '@tanstack/react-router'
import { useEffect } from 'react'
import { AppShell, TopNav } from '@/components/layout'
import { ensureSession, useLogout, useMe, useSession } from '@/features/auth'
import { useProfiles } from '@/features/profiles'
import { useUiStore } from '@/stores/ui'

export const Route = createFileRoute('/_app')({
  beforeLoad: async ({ location }) => {
    if (!(await ensureSession())) {
      throw redirect({ to: '/login', search: { redirect: location.href } })
    }
  },
  component: AppLayout,
})

const links = [
  { to: '/history', label: 'Continue watching' },
  { to: '/profiles', label: 'Profiles' },
  { to: '/settings', label: 'Settings' },
] as const

function AccountMenu() {
  const navigate = useNavigate()
  const me = useMe()
  const profiles = useProfiles()
  const activeProfileId = useUiStore((s) => s.activeProfileId)
  const logout = useLogout()
  const active = profiles.data?.find((p) => p.id === activeProfileId)

  return (
    <Menu>
      <MenuTrigger asChild>
        {active ? (
          <button
            type="button"
            className="nr-account-trigger"
            aria-label={`Account menu for ${active.name}`}
          >
            <Avatar
              name={active.name}
              color={active.avatar_color ?? undefined}
              size="sm"
              decorative
            />
          </button>
        ) : (
          <IconButton icon="user" aria-label="Account menu" />
        )}
      </MenuTrigger>
      <MenuContent>
        <MenuLabel>{me.data?.display_name ?? 'Your account'}</MenuLabel>
        <MenuItem icon="users" onSelect={() => void navigate({ to: '/profiles' })}>
          Switch profile
        </MenuItem>
        <MenuItem icon="settings" onSelect={() => void navigate({ to: '/settings' })}>
          Settings
        </MenuItem>
        <MenuItem icon="credit-card" onSelect={() => void navigate({ to: '/plan' })}>
          Manage plan
        </MenuItem>
        <MenuSeparator />
        <MenuItem
          icon="log-out"
          onSelect={() =>
            logout.mutate(undefined, { onSettled: () => void navigate({ to: '/login' }) })
          }
        >
          Sign out
        </MenuItem>
      </MenuContent>
    </Menu>
  )
}

function AppLayout() {
  const navigate = useNavigate()
  const signedIn = useSession((s) => s.accessToken !== null)
  const theme = useMatches({
    select: (matches) => matches.findLast((m) => m.staticData.theme)?.staticData.theme,
  })

  // Refresh failed mid-session (token revoked or expired): send the viewer to sign in.
  useEffect(() => {
    if (!signedIn) void navigate({ to: '/login' })
  }, [signedIn, navigate])

  return (
    <AppShell theme={theme} header={<TopNav links={[...links]} actions={<AccountMenu />} />}>
      <Outlet />
    </AppShell>
  )
}
