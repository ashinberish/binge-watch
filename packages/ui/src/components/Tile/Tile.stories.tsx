import type { Meta, StoryObj } from '@storybook/react-vite'
import { fn } from 'storybook/test'
import { Badge } from '../Badge'
import { Tile } from './Tile'

const art =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 9"><defs><linearGradient id="g" x1="0" x2="1" y1="0" y2="1"><stop offset="0" stop-color="#3a1512"/><stop offset="1" stop-color="#0b0b0c"/></linearGradient></defs><rect width="16" height="9" fill="url(#g)"/></svg>',
  )

const meta = {
  title: 'Primitives/Tile',
  component: Tile,
  args: { title: 'Night Shift', meta: 'S2 · E5 · 18 min left', progress: 0.62, onClick: fn() },
  argTypes: { progress: { control: { type: 'range', min: 0, max: 1, step: 0.01 } } },
  parameters: { layout: 'padded' },
} satisfies Meta<typeof Tile>

export default meta
type Story = StoryObj<typeof meta>

export const TitleFallback: Story = {}
export const WithArt: Story = { args: { art } }
export const WithBadge: Story = {
  args: { badge: <Badge variant="new">New episode</Badge>, progress: null },
}
export const Row: Story = {
  render: (args) => (
    <div style={{ display: 'flex', gap: 16, padding: 24 }}>
      <Tile {...args} />
      <Tile
        {...args}
        title="The Long Road Home"
        art={art}
        meta="S1 · E2 · 41 min left"
        progress={0.12}
      />
      <Tile {...args} title="Harbour Lights" meta="S4 · E10 · 3 min left" progress={0.94} />
    </div>
  ),
}
