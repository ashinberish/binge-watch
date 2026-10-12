import type { Meta, StoryObj } from '@storybook/react-vite'
import { Avatar } from './Avatar'

const meta = {
  title: 'Primitives/Avatar',
  component: Avatar,
  args: { name: 'Ana Lopez', color: '#d32f23', size: 'lg' },
  argTypes: {
    size: { control: 'inline-radio', options: ['sm', 'md', 'lg', 'xl'] },
    color: { control: 'color' },
  },
} satisfies Meta<typeof Avatar>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
export const Palette: Story = {
  render: (args) => (
    <div style={{ display: 'flex', gap: 12 }}>
      {['#d32f23', '#f5b841', '#5aa9ff', '#3fbf7f', '#b07cff', '#ff8a3d'].map((c, i) => (
        <Avatar
          key={c}
          {...args}
          color={c}
          name={['Ana Lopez', 'Kai', 'Mo Reyes', 'Sam', 'Lee Park', 'Jo'][i] ?? 'Viewer'}
        />
      ))}
    </div>
  ),
}
