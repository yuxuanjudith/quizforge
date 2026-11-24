import { useEffect, useState } from 'react'
import { callAction } from '../../lib/actions-client'

/**
 * Estimate (server time − local time) once per mount. The deadline is a
 * server timestamp, so a laptop whose clock is 5 s fast would otherwise show
 * 5 s less than it really has. Half the round trip is attributed to each leg.
 */
export function useServerOffset(): number {
  const [offset, setOffset] = useState(0)
  useEffect(() => {
    let alive = true
    const sent = Date.now()
    callAction<{ now: number }>('clock')
      .then(({ now }) => {
        const received = Date.now()
        if (alive) setOffset(now - (sent + received) / 2)
      })
      .catch(() => {
        /* fall back to local time */
      })
    return () => {
      alive = false
    }
  }, [])
  return offset
}

/** Milliseconds left until `endsAt` (server time), ticking ~10×/s. */
export function useRemainingMs(endsAt: number | undefined, offset: number): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!endsAt) return
    const id = setInterval(() => setNow(Date.now()), 100)
    return () => clearInterval(id)
  }, [endsAt])
  if (!endsAt) return 0
  return Math.max(0, endsAt - (now + offset))
}
