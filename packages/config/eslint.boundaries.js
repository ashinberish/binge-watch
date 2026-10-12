// @ts-check
import boundaries from 'eslint-plugin-boundaries'

/**
 * Layered architecture for apps/web. Imports may only point downward:
 *
 *   app (main, providers, router) → routes → features → components → @nightreel/ui
 *
 * `lib` and `stores` are infrastructure that any layer above them may use, but they
 * never import from features, components or routes. Features never import each other;
 * anything two features need belongs in components, lib or stores.
 * Features are consumed only through their index.ts (no-restricted-imports below).
 * src/main.tsx is the entry point and is not classified.
 *
 * @param {{ tsconfigProject?: string | string[] }} [options]
 * @returns {import('eslint').Linter.Config[]}
 */
export function webBoundaries(options = {}) {
  const { tsconfigProject = './tsconfig.json' } = options
  return [
    {
      files: ['src/**/*.{ts,tsx}'],
      plugins: { boundaries },
      settings: {
        'import/resolver': {
          typescript: { alwaysTryTypes: true, project: tsconfigProject },
        },
        'boundaries/include': ['src/**/*'],
        'boundaries/files': [{ category: 'test', pattern: '**/*.test.{ts,tsx}' }],
        'boundaries/elements': [
          { type: 'routes', pattern: 'src/app/routes' },
          { type: 'app', pattern: 'src/app' },
          { type: 'features', pattern: 'src/features/*', capture: ['feature'] },
          { type: 'components', pattern: 'src/components/*', capture: ['group'] },
          { type: 'stores', pattern: 'src/stores' },
          { type: 'lib', pattern: 'src/lib' },
          { type: 'test', pattern: 'src/test' },
        ],
      },
      rules: {
        // A feature's index.ts is its only public surface.
        'no-restricted-imports': [
          'error',
          {
            patterns: [
              {
                group: ['@/features/*/**'],
                message: 'Import features through their index, e.g. "@/features/auth".',
              },
            ],
          },
        ],
        'boundaries/dependencies': [
          'error',
          {
            default: 'disallow',
            policies: [
              {
                from: { element: { type: 'app' } },
                allow: {
                  to: {
                    element: {
                      types: {
                        anyOf: ['app', 'routes', 'features', 'components', 'stores', 'lib'],
                      },
                    },
                  },
                },
              },
              {
                from: { element: { type: 'routes' } },
                allow: {
                  to: {
                    element: {
                      types: {
                        anyOf: ['app', 'routes', 'features', 'components', 'stores', 'lib'],
                      },
                    },
                  },
                },
              },
              // A feature may import its own files, plus anything below it.
              {
                from: { element: { type: 'features' } },
                allow: {
                  to: { element: { types: { anyOf: ['components', 'stores', 'lib'] } } },
                },
              },
              {
                from: { element: { type: 'features' } },
                allow: {
                  to: {
                    element: {
                      type: 'features',
                      captured: { feature: '{{ from.captured.feature }}' },
                    },
                  },
                },
              },
              {
                from: { element: { type: 'components' } },
                allow: { to: { element: { type: 'components' } } },
              },
              {
                from: { element: { type: 'stores' } },
                allow: { to: { element: { types: { anyOf: ['stores', 'lib'] } } } },
              },
              {
                from: { element: { type: 'lib' } },
                allow: { to: { element: { type: 'lib' } } },
              },
              // Test files anywhere may use the shared test harness (MSW server, render helpers).
              {
                from: { file: { categories: 'test' } },
                allow: { to: { element: { type: 'test' } } },
              },
              {
                from: { element: { type: 'test' } },
                allow: {
                  to: {
                    element: {
                      types: {
                        anyOf: ['app', 'routes', 'features', 'components', 'stores', 'lib', 'test'],
                      },
                    },
                  },
                },
              },
            ],
          },
        ],
      },
    },
  ]
}

export default webBoundaries
