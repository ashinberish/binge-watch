// @ts-check
import jsxA11y from 'eslint-plugin-jsx-a11y'
import reactHooks from 'eslint-plugin-react-hooks'
import tseslint from 'typescript-eslint'
import base from './eslint.base.js'

/** Flat config for React (Vite) workspaces: base + hooks + a11y. */
export default tseslint.config(...base, {
  files: ['**/*.{ts,tsx}'],
  plugins: {
    'react-hooks': reactHooks,
    'jsx-a11y': jsxA11y,
  },
  languageOptions: {
    parserOptions: { ecmaFeatures: { jsx: true } },
  },
  rules: {
    ...reactHooks.configs.recommended.rules,
    ...jsxA11y.flatConfigs.recommended.rules,
    // Focus rings must never be removed; autofocus breaks screen reader context.
    'jsx-a11y/no-autofocus': 'error',
    // Our design-system inputs render native controls.
    'jsx-a11y/label-has-associated-control': [
      'error',
      {
        assert: 'either',
        depth: 3,
        controlComponents: ['Input', 'Select', 'Toggle', 'Checkbox', 'TextArea'],
      },
    ],
  },
})
