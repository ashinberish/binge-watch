import axe from 'axe-core'
import { expect } from 'vitest'

/**
 * A light axe check for React tests (jsdom). Colour contrast cannot be computed in jsdom
 * (the tokens cover it), and `region` only applies to whole pages.
 */
export async function expectNoA11yViolations(container: Element): Promise<void> {
  const results = await axe.run(container, {
    rules: {
      'color-contrast': { enabled: false },
      region: { enabled: false },
    },
  })
  const summary = results.violations.map(
    (v) => `${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(' ')).join(', ')})`,
  )
  expect(summary).toEqual([])
}
