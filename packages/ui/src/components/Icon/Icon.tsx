import {
  Bell,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  CircleAlert,
  Clock,
  CreditCard,
  Ellipsis,
  Eye,
  EyeOff,
  Flame,
  History,
  Info,
  ListPlus,
  LoaderCircle,
  LogOut,
  Moon,
  Pause,
  Pencil,
  Play,
  Plus,
  Search,
  Settings,
  SkipForward,
  Sun,
  Trash2,
  TriangleAlert,
  Tv,
  User,
  Users,
  X,
  type LucideIcon,
  type LucideProps,
} from 'lucide-react'
import { createElement } from 'react'
import { cn } from '../../utils/cn'

/**
 * Curated icon names. Importing the full lucide map would defeat tree-shaking, so
 * anything not listed here is passed as a component: `<Icon icon={Popcorn} />`.
 */
export const iconRegistry = {
  bell: Bell,
  check: Check,
  'chevron-down': ChevronDown,
  'chevron-left': ChevronLeft,
  'chevron-right': ChevronRight,
  'chevron-up': ChevronUp,
  'circle-alert': CircleAlert,
  clock: Clock,
  'credit-card': CreditCard,
  ellipsis: Ellipsis,
  eye: Eye,
  'eye-off': EyeOff,
  flame: Flame,
  history: History,
  info: Info,
  'list-plus': ListPlus,
  loader: LoaderCircle,
  'log-out': LogOut,
  moon: Moon,
  pause: Pause,
  pencil: Pencil,
  play: Play,
  plus: Plus,
  search: Search,
  settings: Settings,
  'skip-forward': SkipForward,
  sun: Sun,
  trash: Trash2,
  'triangle-alert': TriangleAlert,
  tv: Tv,
  user: User,
  users: Users,
  x: X,
} as const satisfies Record<string, LucideIcon>

export type IconName = keyof typeof iconRegistry
export type IconSource = IconName | LucideIcon

/** Icon sizes: 20px on web, 16px in the extension. */
export const ICON_SIZE = { web: 20, extension: 16 } as const
export const ICON_STROKE = 1.75

export interface IconProps extends Omit<LucideProps, 'size'> {
  icon: IconSource
  /** `web` (20px, default), `extension` (16px) or an explicit pixel size. */
  size?: keyof typeof ICON_SIZE | number
  /** Accessible name. Omit for decorative icons, which are hidden from assistive tech. */
  label?: string
}

export function resolveIcon(icon: IconSource): LucideIcon {
  return typeof icon === 'string' ? iconRegistry[icon] : icon
}

export function Icon({ icon, size = 'web', label, className, strokeWidth, ...props }: IconProps) {
  const px = typeof size === 'number' ? size : ICON_SIZE[size]
  // createElement: the component comes from a static registry, never created per render.
  return createElement(resolveIcon(icon), {
    size: px,
    strokeWidth: strokeWidth ?? ICON_STROKE,
    className: cn('nr-icon', className),
    focusable: 'false',
    ...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true }),
    ...props,
  })
}
