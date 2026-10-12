import { Input } from '@nightreel/ui'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { expectNoA11yViolations } from '@/test/render'
import { FormField } from './FormField'

describe('FormField', () => {
  it('wires label, hint and error to the control', async () => {
    const { container } = render(
      <FormField label="Display name" hint="Shown on your profiles." error="Enter a name">
        {(field) => <Input {...field} />}
      </FormField>,
    )
    const input = screen.getByLabelText('Display name')
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(input).toHaveAccessibleDescription('Shown on your profiles. Enter a name')
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a name')
    await expectNoA11yViolations(container)
  })
})
