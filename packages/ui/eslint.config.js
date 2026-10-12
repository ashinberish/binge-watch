import react from '@nightreel/config/eslint.react.js'
import storybook from 'eslint-plugin-storybook'

export default [
  { ignores: ['storybook-static/**', '!.storybook'] },
  ...react,
  ...storybook.configs['flat/recommended'],
]
