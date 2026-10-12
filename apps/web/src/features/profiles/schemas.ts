import { AVATAR_COLORS } from '@nightreel/shared'
import { z } from 'zod'

export const profileSchema = z.object({
  name: z.string().trim().min(1, 'Enter a profile name').max(30, 'Use 30 characters or fewer'),
  avatar_color: z.enum(AVATAR_COLORS),
  is_kids: z.boolean(),
})

export type ProfileValues = z.infer<typeof profileSchema>
