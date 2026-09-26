import { describe, expect, it } from "vitest"

import { TOKEN_TTL_MS, auditKeyHealth } from "@/lib/auth/key-lifecycle"

/**
 * The audit is the tripwire for drift between the environment, the registry and
 * the JWKS. Each case below is a state that is silent from the server's point of
 * view but breaks relying parties, so each must be reported.
 */

const NOW = new Date("2026-01-01T12:00:00Z")
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 60 * 60 * 1000)

const active = (kid: string) => ({ kid, status: "ACTIVE", retiredAt: null })
const retired = (kid: string, hours = 0.5) => ({ kid, status: "RETIRED", retiredAt: hoursAgo(hours) })

/** A healthy baseline: one ACTIVE key, published, matching the environment. */
function healthy() {
  return {
    envKid: "k1",
    rows: [active("k1")],
    jwksKids: ["k1"],
    now: NOW,
  }
}

const codes = (issues: { code: string }[]) => issues.map((i) => i.code)

describe("auditKeyHealth", () => {
  it("reports nothing when everything agrees", () => {
    expect(auditKeyHealth(healthy())).toEqual([])
  })

  it("reports nothing for a healthy rotation with a retired key still published", () => {
    const issues = auditKeyHealth({
      ...healthy(),
      rows: [retired("k0"), active("k1")],
      jwksKids: ["k1", "k0"],
    })
    expect(issues).toEqual([])
  })

  describe("environment vs registry", () => {
    it("flags an environment key that is not the ACTIVE key", () => {
      const issues = auditKeyHealth({ ...healthy(), envKid: "other" })
      expect(codes(issues)).toContain("env-key-not-registered")
      expect(issues.find((i) => i.code === "env-key-not-registered")?.severity).toBe("error")
    })

    it("flags an unreadable environment key", () => {
      expect(codes(auditKeyHealth({ ...healthy(), envKid: null }))).toContain("env-key-not-registered")
    })

    it("does not flag the environment when it matches a RETIRED-but-published key's sibling", () => {
      // env points at the ACTIVE key; the retired one is unrelated.
      const issues = auditKeyHealth({
        envKid: "k1",
        rows: [retired("k0"), active("k1")],
        jwksKids: ["k1", "k0"],
        now: NOW,
      })
      expect(issues).toEqual([])
    })
  })

  describe("registry shape", () => {
    it("flags a registry with no ACTIVE key", () => {
      const issues = auditKeyHealth({ envKid: null, rows: [retired("k0", 5)], jwksKids: [], now: NOW })
      expect(codes(issues)).toContain("no-active-key")
    })

    it("flags multiple ACTIVE keys", () => {
      const issues = auditKeyHealth({
        envKid: "k1",
        rows: [active("k1"), active("k2")],
        jwksKids: ["k1", "k2"],
        now: NOW,
      })
      expect(codes(issues)).toContain("multiple-active-keys")
    })
  })

  describe("JWKS coverage", () => {
    it("flags an ACTIVE key that is not published", () => {
      const issues = auditKeyHealth({ ...healthy(), jwksKids: [] })
      expect(codes(issues)).toContain("active-key-not-published")
    })

    it("flags a retired key still in its grace period that is not published", () => {
      const issues = auditKeyHealth({
        envKid: "k1",
        rows: [retired("k0", 0.5), active("k1")],
        jwksKids: ["k1"],
        now: NOW,
      })
      expect(codes(issues)).toContain("retired-key-not-published")
    })

    it("does not require an expired retired key to stay published", () => {
      const issues = auditKeyHealth({
        envKid: "k1",
        rows: [retired("k0", 5), active("k1")],
        jwksKids: ["k1"],
        now: NOW,
      })
      expect(codes(issues)).not.toContain("retired-key-not-published")
    })
  })

  describe("cleanup housekeeping", () => {
    it("warns (not errors) about retired keys past their grace period", () => {
      const issues = auditKeyHealth({
        envKid: "k1",
        rows: [retired("k0", 5), active("k1")],
        jwksKids: ["k1", "k0"],
        now: NOW,
      })
      const stale = issues.find((i) => i.code === "stale-retired-keys")
      expect(stale?.severity).toBe("warning")
    })

    it("does not warn while a retired key is inside its grace period", () => {
      const issues = auditKeyHealth({
        envKid: "k1",
        rows: [retired("k0", 0.5), active("k1")],
        jwksKids: ["k1", "k0"],
        now: NOW,
      })
      expect(codes(issues)).not.toContain("stale-retired-keys")
    })

    it("honours a custom ttl", () => {
      const issues = auditKeyHealth({
        envKid: "k1",
        rows: [retired("k0", 0.5), active("k1")],
        jwksKids: ["k1", "k0"],
        now: NOW,
        ttlMs: 60_000,
      })
      expect(codes(issues)).toContain("stale-retired-keys")
    })
  })

  it("treats the default ttl as one hour", () => {
    const boundary = new Date(NOW.getTime() - TOKEN_TTL_MS)
    const issues = auditKeyHealth({
      envKid: "k1",
      rows: [{ kid: "k0", status: "RETIRED", retiredAt: boundary }, active("k1")],
      jwksKids: ["k1", "k0"],
      now: NOW,
    })
    expect(codes(issues)).toContain("stale-retired-keys")
  })
})
