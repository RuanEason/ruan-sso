import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { checkRateLimit, resetRateLimit } from "@/lib/auth/rate-limit"

/**
 * The limiter is the only thing standing between the login endpoint and
 * unbounded password guessing, so its window and boundary behaviour are
 * pinned here with a controlled clock.
 */
describe("checkRateLimit", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("allows exactly `limit` attempts, then blocks", () => {
    const key = `k-${Math.random()}`
    for (let i = 0; i < 5; i++) {
      expect(checkRateLimit(key, 5, 60_000).allowed).toBe(true)
    }
    const blocked = checkRateLimit(key, 5, 60_000)
    expect(blocked.allowed).toBe(false)
    expect(blocked.remaining).toBe(0)
  })

  it("reports remaining attempts decreasing to zero", () => {
    const key = `k-${Math.random()}`
    expect(checkRateLimit(key, 3, 60_000).remaining).toBe(2)
    expect(checkRateLimit(key, 3, 60_000).remaining).toBe(1)
    expect(checkRateLimit(key, 3, 60_000).remaining).toBe(0)
  })

  it("reports a retryAfter in whole seconds while blocked", () => {
    const key = `k-${Math.random()}`
    checkRateLimit(key, 1, 60_000)
    const blocked = checkRateLimit(key, 1, 60_000)
    expect(blocked.allowed).toBe(false)
    expect(blocked.retryAfter).toBeGreaterThan(0)
    expect(blocked.retryAfter).toBeLessThanOrEqual(60)
  })

  it("resets once the window elapses", () => {
    const key = `k-${Math.random()}`
    checkRateLimit(key, 1, 60_000)
    expect(checkRateLimit(key, 1, 60_000).allowed).toBe(false)

    vi.advanceTimersByTime(60_001)
    expect(checkRateLimit(key, 1, 60_000).allowed).toBe(true)
  })

  it("keeps a blocked key blocked just before the window ends", () => {
    const key = `k-${Math.random()}`
    checkRateLimit(key, 1, 60_000)
    vi.advanceTimersByTime(59_000)
    expect(checkRateLimit(key, 1, 60_000).allowed).toBe(false)
  })

  it("tracks keys independently", () => {
    const a = `a-${Math.random()}`
    const b = `b-${Math.random()}`
    checkRateLimit(a, 1, 60_000)
    expect(checkRateLimit(a, 1, 60_000).allowed).toBe(false)
    // A different account/IP must be unaffected by another key's exhaustion.
    expect(checkRateLimit(b, 1, 60_000).allowed).toBe(true)
  })
})

describe("resetRateLimit", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("clears a key so a successful login restores the budget", () => {
    const key = `k-${Math.random()}`
    checkRateLimit(key, 2, 60_000)
    checkRateLimit(key, 2, 60_000)
    expect(checkRateLimit(key, 2, 60_000).allowed).toBe(false)

    resetRateLimit(key)
    expect(checkRateLimit(key, 2, 60_000).allowed).toBe(true)
  })
})
