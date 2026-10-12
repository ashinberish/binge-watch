import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { expectNoA11yViolations } from '../../test/axe'
import { Select } from './Select'

const options = [
  { value: 'en', label: 'English' },
  { value: 'es', label: 'Spanish' },
]

describe('Select', () => {
  it('renders a labelled combobox with a placeholder', async () => {
    const { container } = render(
      <Select aria-label="Audio language" placeholder="Choose a language" options={options} />,
    )
    const trigger = screen.getByRole('combobox', { name: 'Audio language' })
    expect(trigger).toHaveTextContent('Choose a language')
    await expectNoA11yViolations(container)
  })

  it('shows the selected value', () => {
    render(<Select aria-label="Audio language" options={options} defaultValue="es" />)
    expect(screen.getByRole('combobox')).toHaveTextContent('Spanish')
  })

  it('marks invalid state', () => {
    render(<Select aria-label="Audio language" options={options} invalid />)
    expect(screen.getByRole('combobox')).toHaveAttribute('aria-invalid', 'true')
  })
})
