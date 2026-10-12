import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { expectNoA11yViolations } from '../../test/axe'
import { Skeleton } from './Skeleton'

describe('Skeleton', () => {
  it('is hidden from assistive tech and sized via props', async () => {
    const { container } = render(
      <div role="status" aria-busy="true" aria-label="Loading shows">
        <Skeleton shape="tile" />
        <Skeleton shape="text" width={120} />
      </div>,
    )
    const [tile, text] = container.querySelectorAll('.nr-skeleton')
    expect(tile).toHaveAttribute('aria-hidden', 'true')
    expect(tile).toHaveClass('nr-skeleton--tile')
    expect(text).toHaveStyle({ width: '120px' })
    await expectNoA11yViolations(container)
  })
})
