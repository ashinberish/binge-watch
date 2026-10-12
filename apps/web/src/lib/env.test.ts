import { describe, expect, it } from 'vitest'
import { parseEnv } from './env'

describe('parseEnv', () => {
  it('defaults and trims trailing slashes', () => {
    expect(parseEnv({}).VITE_API_URL).toBe('http://localhost:8000')
    expect(parseEnv({ VITE_API_URL: 'https://api.nightreel.app/' }).VITE_API_URL).toBe(
      'https://api.nightreel.app',
    )
  })

  it('rejects invalid URLs', () => {
    expect(() => parseEnv({ VITE_API_URL: 'not a url' })).toThrow(/Invalid environment/)
  })
})
