import { useEffect, useState } from 'react'

/** Seconds left until `onDone` fires; null while not running. */
export function useCountdown(seconds: number | null, onDone: () => void) {
  const [left, setLeft] = useState(seconds)

  useEffect(() => setLeft(seconds), [seconds])

  useEffect(() => {
    if (left === null) return
    if (left <= 0) {
      onDone()
      return
    }
    const timer = setTimeout(() => setLeft(left - 1), 1000)
    return () => clearTimeout(timer)
  }, [left, onDone])

  return left
}
