import type { Meta, StoryObj } from '@storybook/react-vite'
import { fn } from 'storybook/test'
import { Icon } from '../Icon'
import { Countdown } from './Countdown'

const meta = {
  title: 'Primitives/Countdown',
  component: Countdown,
  args: { seconds: 10, onComplete: fn() },
} satisfies Meta<typeof Countdown>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
export const Paused: Story = { args: { paused: true } }
export const WithIcon: Story = { args: { size: 72, children: <Icon icon="play" /> } }
