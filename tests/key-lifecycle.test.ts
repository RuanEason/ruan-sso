import { describe, expect, it } from "vitest"

import { TOKEN_TTL_MS, partitionRetiredKeys } from "@/lib/auth/key-lifecycle"

/**
 * Deleting a signing key is irreversible, and deleting one too early invalidates
 * every token it signed. These tests pin the boundary: exactly 1 hour after
 * retirement a key becomes eligible, and one millisecond before that it does not.
 */

const NOW = new Date("2026-01-01T12:00:00Z")
const retiredHoursAgo = (hours: number) => new Date(NOW.getTime() - hours * 60 * 60 * 1000)

const row = (overrides: Partial<{ kid: string; status: string; retiredAt: Date | null }> = {}) => ({
  kid: "kid-1",
  status: "RETIRED",
  retiredAt: retiredHoursAgo(2),
  ...overrides,
})

describe("TOKEN_TTL_MS", () => {
  it("is one hour, matching ACCESS_TOKEN_TTL_SEC", () => {
    expect(TOKEN_TTL_MS).toBe(60 * 60 * 1000)
  })
})

describe("partitionRetiredKeys", () => {
  it("makes a key eligible once the grace period has elapsed", () => {
    const { eligible, tooEarly } = partitionRetiredKeys([row()], NOW)
    expect(eligible.map((k) => k.kid)).toEqual(["kid-1"])
    expect(tooEarly).toEqual([])
  })

  it("holds a key back while it is still inside the grace period", () => {
    const { eligible, tooEarly } = partitionRetiredKeys([row({ retiredAt: retiredHoursAgo(0.5) })], NOW)
    expect(eligible).toEqual([])
    expect(tooEarly.map((k) => k.kid)).toEqual(["kid-1"])
  })

  it("treats the exact boundary as eligible", () => {
    const boundary = new Date(NOW.getTime() - TOKEN_TTL_MS)
    expect(partitionRetiredKeys([row({ retiredAt: boundary })], NOW).eligible).toHaveLength(1)
  })

  it("holds a key back one millisecond before the boundary", () => {
    const justInside = new Date(NOW.getTime() - TOKEN_TTL_MS + 1)
    expect(partitionRetiredKeys([row({ retiredAt: justInside })], NOW).eligible).toEqual([])
  })

  it("never makes an ACTIVE key eligible", () => {
    // A fresh ACTIVE key has no retiredAt, and even a stale one must be skipped.
    const rows = [
      row({ kid: "active-1", status: "ACTIVE", retiredAt: null }),
      row({ kid: "active-2", status: "ACTIVE", retiredAt: retiredHoursAgo(99) }),
    ]
    const { eligible, tooEarly } = partitionRetiredKeys(rows, NOW)
    expect(eligible).toEqual([])
    expect(tooEarly).toEqual([])
  })

  it("holds back a RETIRED key with no retiredAt rather than guessing", () => {
    const { eligible, tooEarly } = partitionRetiredKeys([row({ retiredAt: null })], NOW)
    expect(eligible).toEqual([])
    expect(tooEarly).toHaveLength(1)
  })

  it("ignores statuses other than ACTIVE and RETIRED", () => {
    const { eligible, tooEarly } = partitionRetiredKeys([row({ status: "PENDING" })], NOW)
    expect(eligible).toEqual([])
    expect(tooEarly).toEqual([])
  })

  it("sorts a mixed set into the two buckets without losing rows", () => {
    const rows = [
      row({ kid: "old", retiredAt: retiredHoursAgo(5) }),
      row({ kid: "new", retiredAt: retiredHoursAgo(0.1) }),
      row({ kid: "active", status: "ACTIVE", retiredAt: null }),
    ]
    const { eligible, tooEarly } = partitionRetiredKeys(rows, NOW)
    expect(eligible.map((k) => k.kid)).toEqual(["old"])
    expect(tooEarly.map((k) => k.kid)).toEqual(["new"])
  })

  it("reports deletableAt on both buckets", () => {
    const retiredAt = retiredHoursAgo(2)
    const { eligible, tooEarly } = partitionRetiredKeys(
      [row({ kid: "a", retiredAt }), row({ kid: "b", retiredAt: retiredHoursAgo(0.5) })],
      NOW
    )
    expect(eligible[0].deletableAt).toEqual(new Date(retiredAt.getTime() + TOKEN_TTL_MS))
    expect(tooEarly[0].deletableAt).toBeInstanceOf(Date)
  })
})
