import { Card, CardBody, CardHeader, Skeleton, Toggle } from '@nightreel/ui'
import { createFileRoute } from '@tanstack/react-router'
import { PageHeader } from '@/components/layout'
import { useMe } from '@/features/auth'
import { DisplayNameForm } from '@/features/settings'
import { useUiStore } from '@/stores/ui'

export const Route = createFileRoute('/_app/settings')({
  staticData: { theme: 'light' },
  component: SettingsPage,
})

function SettingsPage() {
  const me = useMe()
  const theme = useUiStore((s) => s.theme)
  const setTheme = useUiStore((s) => s.setTheme)
  return (
    <>
      <PageHeader title="Settings" description="Manage your account and how Nightreel looks." />
      <div className="nr-stack">
        <Card aria-labelledby="settings-account">
          <CardHeader id="settings-account" title="Account" description={me.data?.email} />
          <CardBody>
            {me.data ? (
              <DisplayNameForm displayName={me.data.display_name} />
            ) : (
              <Skeleton shape="rect" height={40} />
            )}
          </CardBody>
        </Card>
        <Card aria-labelledby="settings-appearance">
          <CardHeader id="settings-appearance" title="Appearance" />
          <CardBody>
            <Toggle
              label="Light theme"
              description="Use light colours everywhere. Account pages are always light."
              checked={theme === 'light'}
              onCheckedChange={(on) => setTheme(on ? 'light' : 'dark')}
            />
          </CardBody>
        </Card>
      </div>
    </>
  )
}
