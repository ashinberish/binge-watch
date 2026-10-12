import { beforeEach, describe, expect, it } from 'vitest'
import { useUiStore } from './ui'

describe('ui store', () => {
  beforeEach(() => {
    useUiStore.setState({ activeProfileId: null, theme: 'dark' })
  })

  it('tracks the active profile and persists it', () => {
    useUiStore.getState().setActiveProfile('p1')
    expect(useUiStore.getState().activeProfileId).toBe('p1')
    expect(localStorage.getItem('nightreel.ui')).toContain('p1')
  })

  it('reset clears the profile but keeps the theme', () => {
    useUiStore.getState().setTheme('light')
    useUiStore.getState().setActiveProfile('p1')
    useUiStore.getState().reset()
    expect(useUiStore.getState()).toMatchObject({ activeProfileId: null, theme: 'light' })
  })
})
