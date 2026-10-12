import type { Meta, StoryObj } from '@storybook/react-vite'
import { fn } from 'storybook/test'
import { Button } from './Button'

const meta = {
  title: 'Primitives/Button',
  component: Button,
  args: { children: 'Resume', onClick: fn() },
  argTypes: {
    variant: { control: 'inline-radio', options: ['primary', 'secondary', 'ghost', 'danger'] },
    size: { control: 'inline-radio', options: ['sm', 'md'] },
  },
} satisfies Meta<typeof Button>

export default meta
type Story = StoryObj<typeof meta>

export const Primary: Story = { args: { icon: 'play' } }
export const Secondary: Story = {
  args: { variant: 'secondary', icon: 'plus', children: 'Add to list' },
}
export const Ghost: Story = { args: { variant: 'ghost', children: 'Manage plan' } }
export const Danger: Story = {
  args: { variant: 'danger', icon: 'trash', children: 'Delete profile' },
}
export const Small: Story = {
  args: { size: 'sm', iconRight: 'skip-forward', children: 'Next episode' },
}
export const Loading: Story = { args: { loading: true } }
export const Disabled: Story = { args: { disabled: true } }

export const All: Story = {
  render: (args) => (
    <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
      <Button {...args} icon="play">
        Resume
      </Button>
      <Button {...args} variant="secondary" icon="plus">
        Add to list
      </Button>
      <Button {...args} variant="ghost">
        Manage plan
      </Button>
      <Button {...args} variant="danger">
        Delete profile
      </Button>
    </div>
  ),
}
