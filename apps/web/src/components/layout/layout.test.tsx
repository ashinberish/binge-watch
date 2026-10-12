import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { expectNoA11yViolations, renderWithRouter } from '@/test/render'
import { AppShell } from './AppShell'
import { PageHeader } from './PageHeader'
import { TopNav } from './TopNav'

describe('layout', () => {
  it('renders the shell with nav, skip link and header', async () => {
    const { container } = await renderWithRouter(
      <AppShell
        theme="light"
        header={
          <TopNav
            links={[
              { to: '/history', label: 'Continue watching' },
              { to: '/settings', label: 'Settings' },
            ]}
            actions={<button type="button">Account</button>}
          />
        }
      >
        <PageHeader title="Settings" description="Manage your account." />
      </AppShell>,
      { path: '/history' },
    )
    expect(screen.getByRole('link', { name: 'Skip to content' })).toHaveAttribute('href', '#main')
    expect(screen.getByRole('link', { name: 'Nightreel home' })).toHaveTextContent('nightreel')
    expect(screen.getByRole('link', { name: 'Continue watching' })).toHaveAttribute(
      'aria-current',
      'page',
    )
    expect(screen.getByRole('heading', { level: 1, name: 'Settings' })).toBeInTheDocument()
    expect(container.querySelector('.nr-shell')).toHaveAttribute('data-theme', 'light')
    await expectNoA11yViolations(container)
  })
})
