import { configureAxe } from 'jest-axe'
import { expect } from 'vitest'

// Colour contrast cannot be computed in jsdom; it is covered by the token palette
// and by the Storybook a11y addon. `region` only applies to full pages.
const axe = configureAxe({
  rules: {
    'color-contrast': { enabled: false },
    region: { enabled: false },
  },
})

/** Run axe on a rendered container and fail with readable output on any violation. */
export async function expectNoA11yViolations(container: Element): Promise<void> {
  const results = await axe(container)
  const summary = results.violations.map(
    (v) => `${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(' ')).join(', ')})`,
  )
  expect(summary).toEqual([])
}
