import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { expectNoA11yViolations } from '../../test/axe'
import { Dialog, DialogClose, DialogContent, DialogFooter, DialogTrigger } from './Dialog'

function Example() {
  return (
    <Dialog>
      <DialogTrigger>Delete profile</DialogTrigger>
      <DialogContent
        title="Delete this profile?"
        description="Watch history for Kai will be removed."
      >
        <DialogFooter>
          <DialogClose>Keep profile</DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

describe('Dialog', () => {
  it('opens with a title and description, and closes', async () => {
    render(<Example />)
    await userEvent.click(screen.getByRole('button', { name: 'Delete profile' }))
    const dialog = screen.getByRole('dialog', { name: 'Delete this profile?' })
    expect(dialog).toHaveAccessibleDescription('Watch history for Kai will be removed.')
    await expectNoA11yViolations(document.body)
    await userEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('closes on Escape', async () => {
    render(<Example />)
    await userEvent.click(screen.getByRole('button', { name: 'Delete profile' }))
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
