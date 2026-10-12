import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { expectNoA11yViolations } from '../../test/axe'
import { ToastProvider, useToast } from './Toast'

function Trigger({ onUndo }: { onUndo: () => void }) {
  const { toast } = useToast()
  return (
    <button
      type="button"
      onClick={() =>
        toast({
          title: 'Added to list',
          description: 'Night Shift is in your list.',
          action: { label: 'Undo', onClick: onUndo },
        })
      }
    >
      Add to list
    </button>
  )
}

describe('Toast', () => {
  it('shows a toast with an action and dismisses it', async () => {
    const onUndo = vi.fn()
    render(
      <ToastProvider>
        <Trigger onUndo={onUndo} />
      </ToastProvider>,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Add to list' }))
    expect(screen.getByText('Added to list')).toBeInTheDocument()
    expect(screen.getByText('Night Shift is in your list.')).toBeInTheDocument()
    await expectNoA11yViolations(document.body)
    await userEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(onUndo).toHaveBeenCalledOnce()
  })

  it('throws outside the provider', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => render(<Trigger onUndo={() => {}} />)).toThrow(/ToastProvider/)
    spy.mockRestore()
  })
})
