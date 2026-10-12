import type { Meta, StoryObj } from '@storybook/react-vite'
import { Button } from '../Button'
import { Card, CardBody, CardFooter, CardHeader } from './Card'

const meta = {
  title: 'Primitives/Card',
  component: Card,
  args: { elevation: 'flat', padding: 'md' },
  argTypes: {
    elevation: { control: 'inline-radio', options: ['flat', 'raised'] },
    padding: { control: 'inline-radio', options: ['none', 'md', 'lg'] },
  },
  render: (args) => (
    <Card {...args} style={{ maxWidth: 420 }}>
      <CardHeader title="Plans are coming soon" description="You are on the free plan." />
      <CardBody>Everything is included while Nightreel is in beta.</CardBody>
      <CardFooter>
        <Button variant="secondary">Manage plan</Button>
      </CardFooter>
    </Card>
  ),
} satisfies Meta<typeof Card>

export default meta
type Story = StoryObj<typeof meta>

export const Flat: Story = {}
export const Raised: Story = { args: { elevation: 'raised' } }
