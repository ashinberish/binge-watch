import type { Meta, StoryObj } from '@storybook/react-vite'
import { Input } from './Input'

const meta = {
  title: 'Primitives/Input',
  component: Input,
  args: { placeholder: 'you@example.com', 'aria-label': 'Email' },
} satisfies Meta<typeof Input>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
export const WithIcon: Story = {
  args: { icon: 'search', placeholder: 'Search shows', 'aria-label': 'Search shows' },
}
export const Invalid: Story = { args: { invalid: true, defaultValue: 'not-an-email' } }
export const Small: Story = { args: { size: 'sm' } }
export const Disabled: Story = { args: { disabled: true } }
