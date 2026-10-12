import type { Meta, StoryObj } from '@storybook/react-vite'
import { IconButton } from '../IconButton'
import { Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger } from './Menu'

const meta = {
  title: 'Primitives/Menu',
  component: MenuContent,
  render: (args) => (
    <Menu>
      <MenuTrigger asChild>
        <IconButton icon="ellipsis" aria-label="More options" />
      </MenuTrigger>
      <MenuContent {...args}>
        <MenuLabel>Kai</MenuLabel>
        <MenuItem icon="users">Switch profile</MenuItem>
        <MenuItem icon="settings">Settings</MenuItem>
        <MenuItem icon="credit-card">Manage plan</MenuItem>
        <MenuSeparator />
        <MenuItem icon="log-out" tone="danger">
          Sign out
        </MenuItem>
      </MenuContent>
    </Menu>
  ),
} satisfies Meta<typeof MenuContent>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
