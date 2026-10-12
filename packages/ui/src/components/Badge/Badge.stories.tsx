import type { Meta, StoryObj } from '@storybook/react-vite'
import { Badge } from './Badge'

const meta = {
  title: 'Primitives/Badge',
  component: Badge,
  args: { children: 'New episode', variant: 'new' },
  argTypes: { variant: { control: 'inline-radio', options: ['neutral', 'new', 'info', 'danger'] } },
} satisfies Meta<typeof Badge>

export default meta
type Story = StoryObj<typeof meta>

export const New: Story = {}
export const Neutral: Story = { args: { variant: 'neutral', children: 'Kids' } }
export const Info: Story = { args: { variant: 'info', children: 'Synced' } }
export const Danger: Story = { args: { variant: 'danger', children: 'Expired' } }
