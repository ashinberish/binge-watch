import type { Meta, StoryObj } from '@storybook/react-vite'
import { Select } from './Select'

const meta = {
  title: 'Primitives/Select',
  component: Select,
  args: {
    'aria-label': 'Autoplay delay',
    placeholder: 'Choose a delay',
    options: [
      { value: '5', label: '5 seconds' },
      { value: '10', label: '10 seconds' },
      { value: '15', label: '15 seconds' },
      { value: 'off', label: 'Off', disabled: true },
    ],
  },
  decorators: [
    (Story) => (
      <div style={{ width: 280 }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Select>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
export const WithValue: Story = { args: { defaultValue: '10' } }
export const Small: Story = { args: { size: 'sm' } }
export const Invalid: Story = { args: { invalid: true } }
