import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { expectNoA11yViolations } from '@/test/render'
import { Pagination } from './Pagination'

describe('Pagination', () => {
  it('moves between pages and disables at the edges', async () => {
    const onPageChange = vi.fn()
    const { container } = render(<Pagination page={1} pageCount={3} onPageChange={onPageChange} />)
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled()
    expect(screen.getByText('Page 1 of 3')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(onPageChange).toHaveBeenCalledWith(2)
    await expectNoA11yViolations(container)
  })

  it('renders nothing for a single page', () => {
    const { container } = render(<Pagination page={1} pageCount={1} onPageChange={() => {}} />)
    expect(container).toBeEmptyDOMElement()
  })
})
