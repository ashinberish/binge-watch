import { z } from 'zod'

export const loginSchema = z.object({
  email: z.email('Enter a valid email address'),
  password: z.string().min(1, 'Enter your password'),
})
export type LoginValues = z.infer<typeof loginSchema>

export const registerSchema = z.object({
  display_name: z.string().trim().min(1, 'Enter your name').max(50, 'Use 50 characters or fewer'),
  email: z.email('Enter a valid email address'),
  password: z.string().min(8, 'Use at least 8 characters'),
})
export type RegisterValues = z.infer<typeof registerSchema>
