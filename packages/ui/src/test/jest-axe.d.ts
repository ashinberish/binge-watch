declare module 'jest-axe' {
  import type { AxeResults, RunOptions, Spec } from 'axe-core'

  export interface JestAxeConfigureOptions extends RunOptions {
    globalOptions?: Spec
    impactLevels?: Array<'minor' | 'moderate' | 'serious' | 'critical'>
  }

  export type JestAxe = (html: Element | string, options?: RunOptions) => Promise<AxeResults>

  export function configureAxe(options?: JestAxeConfigureOptions): JestAxe
  export const axe: JestAxe
}
