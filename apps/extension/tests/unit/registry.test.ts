import { describe, expect, it } from 'vitest'

import { adapterFor, adapterForSite } from '../../src/adapters/registry'

describe('adapterFor', () => {
  it('finds the adapter for a supported player page', () => {
    expect(adapterFor('https://www.youtube.com/watch?v=abc')?.id).toBe('youtube')
  })

  it('ignores pages without a player', () => {
    expect(adapterFor('https://www.youtube.com/feed/subscriptions')).toBeUndefined()
    expect(adapterFor('https://example.com/')).toBeUndefined()
  })
})

describe('adapterForSite', () => {
  it('finds the adapter on any page of a supported site', () => {
    expect(adapterForSite('https://www.youtube.com/feed/subscriptions')?.id).toBe('youtube')
    expect(adapterForSite('https://example.com/')).toBeUndefined()
    expect(adapterForSite('https://notyoutube.com/')).toBeUndefined()
  })
})
