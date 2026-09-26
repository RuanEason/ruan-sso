import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * The audit trail is the most attractive table to dump and the last line of
 * defence during an investigation, so its write layer has two invariants that
 * must hold no matter what a caller passes:
 *
 *   1. no credential ever reaches the table, and
 *   2. a failing audit write never fails the operation being audited.
 *
 * Prisma is mocked so these stay pure.
 */
const auditCreate = vi.fn()

vi.mock("@/lib/db", () => ({
  prisma: {
    auditLog: { create: (...args: unknown[]) => auditCreate(...args) },
  },
}))

const { recordAudit, redactMetadata, truncate, clientIp, MAX_FIELD_LENGTH } =
  await import("@/lib/audit/log")

beforeEach(() => {
  vi.clearAllMocks()
  auditCreate.mockResolvedValue({})
})

describe("redactMetadata", () => {
  it("refuses keys that could carry a credential", () => {
    // Refusing (rather than stripping) turns a mistake into a loud test
    // failure instead of a silent secret in the trail.
    for (const key of [
      "password",
      "clientSecret",
      "access_token",
      "refreshToken",
      "code",
      "codeVerifier",
      "passwordHash",
      "privateKeyPem",
      "authorization",
    ]) {
      expect(() => redactMetadata({ [key]: "x" })).toThrow(/forbidden/i)
    }
  })

  it("keeps ordinary scalar detail", () => {
    expect(
      redactMetadata({ scopes: "openid profile", role: "ADMIN", via: "consent_screen" })
    ).toEqual({ scopes: "openid profile", role: "ADMIN", via: "consent_screen" })
  })

  it("truncates long strings and flattens arrays to a bounded string", () => {
    const long = "u".repeat(500)
    const out = redactMetadata({ attempted: long, redirectUris: ["a", "b"] })
    expect((out?.attempted as string).length).toBeLessThanOrEqual(MAX_FIELD_LENGTH)
    expect(out?.redirectUris).toBe("a b")
  })

  it("replaces nested objects rather than storing arbitrary structure", () => {
    expect(redactMetadata({ nested: { deep: "value" } })).toEqual({
      nested: "[omitted]",
    })
  })

  it("passes null through and returns undefined for no metadata", () => {
    expect(redactMetadata({ a: null })).toEqual({ a: null })
    expect(redactMetadata(undefined)).toBeUndefined()
  })
})

describe("truncate", () => {
  it("bounds attacker-controlled input before it reaches a column", () => {
    // Login failures store the submitted username verbatim, so an oversized
    // value must not be able to write an unbounded row.
    expect(truncate("a".repeat(1000)).length).toBeLessThanOrEqual(MAX_FIELD_LENGTH)
    expect(truncate("short")).toBe("short")
  })
})

describe("clientIp", () => {
  it("prefers the first forwarded address", () => {
    const req = new Request("http://x/", {
      headers: { "x-forwarded-for": "1.2.3.4, 5.6.7.8" },
    })
    expect(clientIp(req)).toBe("1.2.3.4")
  })

  it("falls back to x-real-ip and then to a placeholder", () => {
    expect(
      clientIp(new Request("http://x/", { headers: { "x-real-ip": "9.9.9.9" } }))
    ).toBe("9.9.9.9")
    expect(clientIp(new Request("http://x/"))).toBe("unknown")
  })
})

describe("recordAudit", () => {
  it("writes the event with a denormalised actor snapshot", async () => {
    await recordAudit({
      action: "ADMIN_USER_DELETED",
      actor: { id: "admin-1", username: "root", role: "ADMIN" },
      targetType: "user",
      targetId: "user-9",
      targetName: "alice",
      request: new Request("http://x/", {
        headers: { "x-forwarded-for": "1.2.3.4", "user-agent": "UA" },
      }),
    })

    expect(auditCreate).toHaveBeenCalledTimes(1)
    const data = auditCreate.mock.calls[0][0].data
    expect(data).toMatchObject({
      action: "ADMIN_USER_DELETED",
      actorId: "admin-1",
      // Snapshot, so the row survives the deletion of the user row itself.
      actorName: "root",
      actorRole: "ADMIN",
      targetId: "user-9",
      targetName: "alice",
      ip: "1.2.3.4",
      userAgent: "UA",
    })
  })

  it("records a failed login without inventing an actor identity", async () => {
    await recordAudit({
      action: "LOGIN_FAILURE",
      actorName: "some-attempted-name",
      request: new Request("http://x/"),
      metadata: { reason: "unknown_user" },
    })

    const data = auditCreate.mock.calls[0][0].data
    // The attempted username is recorded as text, never as an actorId: it is
    // attacker-supplied and is not an identity.
    expect(data.actorId).toBeNull()
    expect(data.actorName).toBe("some-attempted-name")
  })

  it("swallows a write failure instead of breaking the audited operation", async () => {
    // If this threw, a full audit table would make login impossible.
    auditCreate.mockRejectedValue(new Error("table is gone"))
    await expect(
      recordAudit({ action: "LOGIN_SUCCESS", actorName: "alice" })
    ).resolves.toBeUndefined()
  })

  it("swallows a redaction failure too", async () => {
    await expect(
      recordAudit({ action: "LOGIN_SUCCESS", metadata: { password: "p" } })
    ).resolves.toBeUndefined()
    expect(auditCreate).not.toHaveBeenCalled()
  })
})
