/** Maximum number of viewer profiles per account. */
export const MAX_PROFILES = 5

/** Seconds of the "next episode" countdown shown by the extension. */
export const NEXT_EPISODE_COUNTDOWN_SECONDS = 10

/** Progress ratio at which an episode counts as watched. */
export const WATCHED_THRESHOLD = 0.92

/** Preset avatar colours offered when creating a profile. */
export const AVATAR_COLORS = [
  '#d32f23',
  '#f5b841',
  '#5aa9ff',
  '#3fbf7f',
  '#b07cff',
  '#ff8a3d',
] as const

export type AvatarColor = (typeof AVATAR_COLORS)[number]
