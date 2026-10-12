import { webBoundaries } from '@nightreel/config/eslint.boundaries.js'
import react from '@nightreel/config/eslint.react.js'

export default [
  { ignores: ['dist/**', 'playwright-report/**', 'test-results/**', 'src/app/routeTree.gen.ts'] },
  ...react,
  ...webBoundaries({ tsconfigProject: './tsconfig.json' }),
]
