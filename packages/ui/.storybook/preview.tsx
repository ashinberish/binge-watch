import type { Decorator, Preview } from '@storybook/react-vite'
import { useEffect, type ReactNode } from 'react'
import '../src/tokens/fonts.css'
import '../src/styles.css'

function ThemeFrame({ theme, children }: { theme: 'dark' | 'light'; children: ReactNode }) {
  useEffect(() => {
    document.documentElement.dataset['theme'] = theme
  }, [theme])
  return (
    <div data-theme={theme} style={{ padding: 24, minHeight: '100%' }}>
      {children}
    </div>
  )
}

const withTheme: Decorator = (Story, context) => {
  const theme = (context.globals['theme'] as 'dark' | 'light' | undefined) ?? 'dark'
  return (
    <ThemeFrame theme={theme}>
      <Story />
    </ThemeFrame>
  )
}

const preview: Preview = {
  globalTypes: {
    theme: {
      description: 'Nightreel theme',
      toolbar: {
        title: 'Theme',
        icon: 'mirror',
        items: [
          { value: 'dark', title: 'Dark' },
          { value: 'light', title: 'Light (account pages)' },
        ],
        dynamicTitle: true,
      },
    },
  },
  initialGlobals: {
    theme: 'dark',
    backgrounds: { value: 'dark' },
  },
  decorators: [withTheme],
  parameters: {
    layout: 'fullscreen',
    backgrounds: {
      options: {
        dark: { name: 'Dark', value: '#0b0b0c' },
        light: { name: 'Light', value: '#f3f3f4' },
      },
    },
    controls: { matchers: { color: /(background|color)$/i } },
    a11y: { test: 'error' },
  },
}

export default preview
