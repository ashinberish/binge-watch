import type { Meta, StoryObj } from '@storybook/react-vite'
import { Skeleton } from './Skeleton'

const meta = {
  title: 'Primitives/Skeleton',
  component: Skeleton,
  args: { shape: 'tile' },
  argTypes: { shape: { control: 'inline-radio', options: ['text', 'rect', 'circle', 'tile'] } },
} satisfies Meta<typeof Skeleton>

export default meta
type Story = StoryObj<typeof meta>

export const Tile: Story = {}
export const TileWithMeta: Story = {
  render: () => (
    <div style={{ display: 'grid', gap: 8, width: 240 }}>
      <Skeleton shape="tile" />
      <Skeleton shape="text" width="70%" />
      <Skeleton shape="text" width="40%" />
    </div>
  ),
}
export const Circle: Story = { args: { shape: 'circle', width: 64 } }
