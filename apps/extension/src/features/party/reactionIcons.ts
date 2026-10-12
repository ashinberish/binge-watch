import { Flame, Frown, Hand, Heart, Laugh, Sparkles, type LucideIcon } from 'lucide-react'

import type { ReactionKind } from '../../party/protocol'

/** The six reactions' icons, shared by the side panel and the overlay over the player. */
export const REACTION_ICONS: Record<ReactionKind, LucideIcon> = {
  heart: Heart,
  laugh: Laugh,
  wow: Sparkles,
  fire: Flame,
  clap: Hand,
  sad: Frown,
}
