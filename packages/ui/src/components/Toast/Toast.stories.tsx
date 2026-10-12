import type { Meta, StoryObj } from '@storybook/react-vite'
import { Button } from '../Button'
import { ToastProvider, useToast } from './Toast'

function Demo() {
  const { toast } = useToast()
  return (
    <div style={{ display: 'flex', gap: 12 }}>
      <Button
        variant="secondary"
        onClick={() =>
          toast({
            title: 'Added to list',
            description: 'Night Shift is in your list.',
            action: { label: 'Undo', onClick: () => {} },
          })
        }
      >
        Add to list
      </Button>
      <Button
        variant="secondary"
        onClick={() =>
          toast({ title: 'Streak saved', description: '5 nights in a row.', variant: 'success' })
        }
      >
        Success
      </Button>
      <Button
        variant="danger"
        onClick={() =>
          toast({
            title: 'Could not sync progress',
            description: 'We will try again shortly.',
            variant: 'danger',
          })
        }
      >
        Error
      </Button>
    </div>
  )
}

const meta = {
  title: 'Primitives/Toast',
  component: ToastProvider,
  args: { children: null },
  render: () => (
    <ToastProvider>
      <Demo />
    </ToastProvider>
  ),
} satisfies Meta<typeof ToastProvider>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
