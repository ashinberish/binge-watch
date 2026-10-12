import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ComponentProps,
  type ReactNode,
} from 'react'
import { cn } from '../../utils/cn'

export interface CountdownProps extends Omit<ComponentProps<'div'>, 'children'> {
  /** Total countdown length in seconds. The ring empties linearly over this time. */
  seconds: number
  /** Called once when the countdown reaches zero. */
  onComplete?: () => void
  paused?: boolean
  /** Diameter in px. */
  size?: number
  /** Accessible label builder. Default: "Next episode in N seconds". */
  formatLabel?: (remaining: number) => string
  /** Centre content; defaults to the remaining seconds. */
  children?: ReactNode
}

const STROKE = 3

/** Circular next-episode countdown ring. */
export function Countdown({
  seconds,
  onComplete,
  paused = false,
  size = 56,
  formatLabel = (n) => `Next episode in ${n} ${n === 1 ? 'second' : 'seconds'}`,
  className,
  style,
  children,
  ...props
}: CountdownProps) {
  const total = Math.max(0, seconds)
  const [elapsedMs, setElapsedMs] = useState(0)
  const onCompleteRef = useRef(onComplete)
  const completed = useRef(false)

  useEffect(() => {
    onCompleteRef.current = onComplete
  }, [onComplete])

  useEffect(() => {
    if (paused || completed.current) return
    let last = Date.now()
    const id = setInterval(() => {
      const now = Date.now()
      const delta = now - last
      last = now
      setElapsedMs((prev) => Math.min(total * 1000, prev + delta))
    }, 100)
    return () => clearInterval(id)
  }, [paused, total])

  const done = elapsedMs >= total * 1000
  useEffect(() => {
    if (done && !completed.current) {
      completed.current = true
      onCompleteRef.current?.()
    }
  }, [done])

  const remaining = Math.max(0, Math.ceil(total - elapsedMs / 1000))
  const r = (size - STROKE) / 2
  const circumference = 2 * Math.PI * r
  const vars = {
    '--nr-countdown-size': `${size}px`,
    '--nr-countdown-duration': `${total}s`,
    '--nr-countdown-circumference': `${circumference}`,
    ...style,
  } as CSSProperties

  return (
    <div
      role="timer"
      aria-live="off"
      aria-label={formatLabel(remaining)}
      className={cn('nr-countdown', paused && 'nr-countdown--paused', className)}
      style={vars}
      {...props}
    >
      <svg
        className="nr-countdown__svg"
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        aria-hidden="true"
      >
        <circle
          className="nr-countdown__track"
          cx={size / 2}
          cy={size / 2}
          r={r}
          strokeWidth={STROKE}
          fill="none"
        />
        <circle
          className="nr-countdown__ring"
          cx={size / 2}
          cy={size / 2}
          r={r}
          strokeWidth={STROKE}
          fill="none"
          strokeDasharray={circumference}
          strokeDashoffset={0}
        />
      </svg>
      <span className="nr-countdown__center" aria-hidden="true">
        {children ?? remaining}
      </span>
    </div>
  )
}
