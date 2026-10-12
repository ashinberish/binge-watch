import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { expectNoA11yViolations } from '../../test/axe'
import { Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger } from './Menu'

describe('Menu', () => {
  it('opens from the keyboard and selects an item', async () => {
    const onSelect = vi.fn()
    render(
      <Menu>
        <MenuTrigger>Account</MenuTrigger>
        <MenuContent>
          <MenuLabel>Kai</MenuLabel>
          <MenuItem icon="settings">Settings</MenuItem>
          <MenuSeparator />
          <MenuItem icon="log-out" tone="danger" onSelect={onSelect}>
            Sign out
          </MenuItem>
        </MenuContent>
      </Menu>,
    )
    const trigger = screen.getByRole('button', { name: 'Account' })
    trigger.focus()
    await userEvent.keyboard('{Enter}')
    expect(screen.getByRole('menu')).toBeInTheDocument()
    await expectNoA11yViolations(document.body)
    await userEvent.click(screen.getByRole('menuitem', { name: 'Sign out' }))
    expect(onSelect).toHaveBeenCalledOnce()
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })
})
