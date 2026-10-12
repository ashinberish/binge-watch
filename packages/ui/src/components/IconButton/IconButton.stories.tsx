import type { Meta, StoryObj } from '@storybook/react-vite'
import { fn } from 'storybook/test'
import { IconButton } from './IconButton'

const meta = {
  title: 'Primitives/IconButton',
  component: IconButton,
  args: { icon: 'settings', 'aria-label': 'Settings', onClick: fn() },
  argTypes: {
    variant: { control: 'inline-radio', options: ['primary', 'secondary', 'ghost'] },
    size: { control: 'inline-radio', options: ['sm', 'md'] },
  },
} satisfies Meta<typeof IconButton>

export default meta
type Story = StoryObj<typeof meta>

export const Ghost: Story = {}
export const Primary: Story = { args: { variant: 'primary', icon: 'play', 'aria-label': 'Play' } }
export const Secondary: Story = {
  args: { variant: 'secondary', icon: 'plus', 'aria-label': 'Add to list' },
}
export const Small: Story = { args: { size: 'sm', icon: 'x', 'aria-label': 'Close' } }
