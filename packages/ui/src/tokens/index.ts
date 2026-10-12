/** Nightreel design tokens as TS values. Mirrors tokens.css (keep in sync). */
export const color = {
  dark: {
    bg: '#0b0b0c',
    surface: '#141416',
    surfaceRaised: '#1f1f23',
    surfaceOverlay: '#2a2a2f',
    scrim: 'rgba(0,0,0,0.72)',
    border: '#3a3a40',
    borderStrong: '#7a7a84',
    ink: '#f5f5f6',
    inkMuted: '#a9a9b2',
    inkSubtle: '#8d8d97',
    brand: '#d32f23',
    brandHover: '#bd2419',
    onBrand: '#ffffff',
    brandText: '#ff6b5f',
    accent: '#f5b841',
    onAccent: '#1a1206',
    info: '#5aa9ff',
    danger: '#ff7a6e',
    focus: '#ffffff',
  },
  light: {
    bg: '#f3f3f4',
    surface: '#ffffff',
    surfaceRaised: '#ffffff',
    surfaceOverlay: '#ebebed',
    scrim: 'rgba(20,20,22,0.56)',
    border: '#d4d4d8',
    borderStrong: '#7e7e87',
    ink: '#141416',
    inkMuted: '#55555c',
    inkSubtle: '#696971',
    brand: '#c82a1f',
    brandHover: '#b12317',
    onBrand: '#ffffff',
    brandText: '#c82a1f',
    accent: '#f5b841',
    onAccent: '#1a1206',
    info: '#1f63b0',
    danger: '#b3261b',
    focus: '#141416',
  },
} as const

export const font = {
  sans: "'Archivo', system-ui, -apple-system, 'Segoe UI', sans-serif",
  display: "'Archivo Narrow', 'Archivo', system-ui, sans-serif",
} as const

export interface TypeStyle {
  family: 'sans' | 'display'
  size: number
  lineHeight: number | string
  weight: 400 | 500 | 600 | 700
  tracking?: string
  uppercase?: boolean
}

export const type = {
  heroTitle: { family: 'display', size: 64, lineHeight: 0.95, weight: 700, tracking: '-0.01em' },
  display: { family: 'display', size: 40, lineHeight: '44px', weight: 700 },
  tileTitle: { family: 'display', size: 18, lineHeight: '20px', weight: 700 },
  title1: { family: 'sans', size: 24, lineHeight: '30px', weight: 600 },
  title2: { family: 'sans', size: 18, lineHeight: '24px', weight: 600 },
  body: { family: 'sans', size: 16, lineHeight: '24px', weight: 400 },
  bodySm: { family: 'sans', size: 14, lineHeight: '20px', weight: 400 },
  label: { family: 'sans', size: 14, lineHeight: '16px', weight: 600, tracking: '0.01em' },
  caption: {
    family: 'sans',
    size: 12,
    lineHeight: '16px',
    weight: 500,
    tracking: '0.02em',
    uppercase: true,
  },
} as const satisfies Record<string, TypeStyle>

export const space = { 1: 4, 2: 8, 3: 12, 4: 16, 6: 24, 8: 32, 12: 48, 16: 64 } as const

export const radius = { sm: 2, md: 4, lg: 8, pill: 999 } as const

export const shadow = {
  lift: { dark: '0 8px 24px rgba(0,0,0,.6)', light: '0 8px 24px rgba(20,20,22,.16)' },
  popup: '0 16px 48px rgba(0,0,0,.7)',
} as const

export const size = {
  tileWidth: 240,
  tileAspect: 16 / 9,
  popupWidth: 380,
  controlHeight: 40,
  controlHeightSm: 32,
  progressHeight: 4,
  pageMax: 1200,
} as const

export const icon = { stroke: 1.75, sizeWeb: 20, sizeExtension: 16 } as const

export const motion = {
  tileHover: { scale: 1.08, durationMs: 200, delayMs: 300, easing: 'ease-out' },
} as const

export type Theme = 'dark' | 'light'

export const tokens = { color, font, type, space, radius, shadow, size, icon, motion } as const
