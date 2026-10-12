import type { Meta, StoryObj } from '@storybook/react-vite'
import { Button } from '../Button'
import { Dialog, DialogClose, DialogContent, DialogFooter, DialogTrigger } from './Dialog'

const meta = {
  title: 'Primitives/Dialog',
  component: DialogContent,
  args: {
    title: 'Delete this profile?',
    description: 'Watch history and streaks for Kai will be removed. You cannot undo this.',
  },
  render: (args) => (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="danger">Delete profile</Button>
      </DialogTrigger>
      <DialogContent {...args}>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="secondary">Keep profile</Button>
          </DialogClose>
          <Button>Delete</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  ),
} satisfies Meta<typeof DialogContent>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
export const Small: Story = { args: { size: 'sm' } }
