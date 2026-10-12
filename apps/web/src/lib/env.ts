import { z } from 'zod'

const envSchema = z.object({
  VITE_API_URL: z.url().default('http://localhost:8000'),
})

export type Env = z.infer<typeof envSchema>

/** Validates import.meta.env once at startup; a bad value fails loudly instead of at the first request. */
export function parseEnv(source: Record<string, unknown>): Env {
  const result = envSchema.safeParse(source)
  if (!result.success) {
    throw new Error(`Invalid environment: ${z.prettifyError(result.error)}`)
  }
  return { VITE_API_URL: result.data.VITE_API_URL.replace(/\/+$/, '') }
}

export const env = parseEnv(import.meta.env)
