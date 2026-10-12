import type { Meta, StoryObj } from '@storybook/react-vite'
import { Icon, iconRegistry, type IconName } from './Icon'

const meta = {
  title: 'Primitives/Icon',
  component: Icon,
  args: { icon: 'play' },
  argTypes: {
    icon: { control: 'select', options: Object.keys(iconRegistry) },
    size: { control: 'inline-radio', options: ['web', 'extension'] },
  },
} satisfies Meta<typeof Icon>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const Registry: Story = {
  render: () => (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 16 }}>
      {(Object.keys(iconRegistry) as IconName[]).map((name) => (
        <div
          key={name}
          style={{
            display: 'grid',
            justifyItems: 'center',
            gap: 4,
            font: 'var(--nr-type-body-sm)',
          }}
        >
          <Icon icon={name} />
          <span>{name}</span>
        </div>
      ))}
    </div>
  ),
}
