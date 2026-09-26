/**
 * Fixed-window rate limiter for credential endpoints.
 *
 * LIMITATION: state is per-process. On a single instance this bounds password
 * guessing; behind multiple instances or a serverless runtime each replica
 * keeps its own counter, so the effective limit multiplies by the replica
 * count. Move `buckets` to a shared store (Redis) before scaling out.
 *
 * Deliberately not used for token-endpoint traffic: those requests are
 * credential-bearing but already rate-limited by the client secret, and a
 * false positive there would break legitimate clients.
 */

type Bucket = { count: number; resetAt: number }

const buckets = new Map<string, Bucket>()

/** Bound memory growth from arbitrary keys; well above any real working set. */
const MAX_BUCKETS = 10_000

export type RateLimitResult = {
  allowed: boolean
  remaining: number
  /** Seconds until the window resets; suitable for a Retry-After header. */
  retryAfter: number
}

export function checkRateLimit(
  key: string,
  limit: number,
  windowMs: number
): RateLimitResult {
  const now = Date.now()
  const existing = buckets.get(key)

  if (!existing || existing.resetAt <= now) {
    if (buckets.size >= MAX_BUCKETS) {
      // Drop expired entries first; only clear wholesale if none are reclaimable.
      for (const [k, v] of buckets) {
        if (v.resetAt <= now) buckets.delete(k)
      }
      if (buckets.size >= MAX_BUCKETS) buckets.clear()
    }
    buckets.set(key, { count: 1, resetAt: now + windowMs })
    return { allowed: true, remaining: limit - 1, retryAfter: 0 }
  }

  existing.count += 1
  const retryAfter = Math.max(1, Math.ceil((existing.resetAt - now) / 1000))

  if (existing.count > limit) {
    return { allowed: false, remaining: 0, retryAfter }
  }

  return { allowed: true, remaining: limit - existing.count, retryAfter }
}

/** Clears a key's window, e.g. after a successful login. */
export function resetRateLimit(key: string): void {
  buckets.delete(key)
}

export const LOGIN_LIMIT = 5
export const LOGIN_WINDOW_MS = 15 * 60 * 1000
