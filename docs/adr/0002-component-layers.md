# 2. Reusable component layers in the web app

- Status: accepted
- Date: 2026-10-12

## Decision

Components sit in four layers, and imports only point downward:

1. **Routes** (`apps/web/src/app/routes`) load data and place one feature per page.
2. **Feature components** (`apps/web/src/features/*/components`) know the API; private to their feature.
3. **Composites** (`apps/web/src/components`) are reusable across features; data in through props only.
4. **Primitives** (`packages/ui`) carry the Nightreel look and no app logic; shared with the extension.

A component used by two features moves up to `src/components`; if the extension needs it,
it moves to `packages/ui`. Every primitive ships with a Storybook story, a test and an a11y check.
`eslint-plugin-boundaries` enforces the direction.
