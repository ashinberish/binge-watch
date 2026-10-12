import { cva, type VariantProps } from 'class-variance-authority'
import type { CSSProperties, ComponentProps } from 'react'
import { cn } from '../../utils/cn'

export const avatarVariants = cva('nr-avatar', {
  variants: {
    size: { sm: 'nr-avatar--sm', md: 'nr-avatar--md', lg: 'nr-avatar--lg', xl: 'nr-avatar--xl' },
  },
  defaultVariants: { size: 'md' },
})

export interface AvatarProps
  extends Omit<ComponentProps<'span'>, 'color' | 'children'>, VariantProps<typeof avatarVariants> {
  name: string
  /** Background colour (hex). Text colour is chosen for contrast. */
  color?: string
  /** Decorative when the name is already visible next to it. */
  decorative?: boolean
}

export function avatarInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  const first = parts[0]?.[0] ?? ''
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : ''
  return (first + last).toUpperCase() || '?'
}

/** Picks near-black or white text for a hex background (WCAG relative luminance). */
export function readableTextOn(hex: string): string {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!match?.[1]) return '#ffffff'
  const n = Number.parseInt(match[1], 16)
  const channel = (c: number) => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  const l =
    0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255)
  // Contrast vs white = 1.05 / (l + .05); vs #1a1206 ≈ (l + .05) / .056
  return 1.05 / (l + 0.05) >= (l + 0.05) / 0.056 ? '#ffffff' : '#1a1206'
}

export function Avatar({
  name,
  color = '#2a2a2f',
  size,
  decorative = false,
  className,
  style,
  ...props
}: AvatarProps) {
  const vars = {
    '--nr-avatar-bg': color,
    '--nr-avatar-fg': readableTextOn(color),
    ...style,
  } as CSSProperties
  return (
    <span
      className={cn(avatarVariants({ size }), className)}
      style={vars}
      {...(decorative ? { 'aria-hidden': true } : { role: 'img', 'aria-label': name })}
      {...props}
    >
      {avatarInitials(name)}
    </span>
  )
}
