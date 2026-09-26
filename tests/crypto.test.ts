import { describe, expect, it } from "vitest"

import {
  generateToken,
  hashToken,
  pkceChallengeS256,
  timingSafeEqualHex,
  timingSafeEqualString,
} from "@/lib/crypto"

describe("generateToken", () => {
  it("produces a URL-safe token of the requested entropy", () => {
    const token = generateToken(32)
    // base64url of 32 bytes is 43 chars, with no padding or unsafe characters.
    expect(token).toHaveLength(43)
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/)
  })

  it("does not repeat across calls", () => {
    const seen = new Set(Array.from({ length: 200 }, () => generateToken(32)))
    expect(seen.size).toBe(200)
  })
})

describe("hashToken", () => {
  it("is a stable sha256 hex digest", () => {
    expect(hashToken("abc")).toBe(hashToken("abc"))
    expect(hashToken("abc")).toMatch(/^[0-9a-f]{64}$/)
  })

  it("differs for different inputs", () => {
    expect(hashToken("abc")).not.toBe(hashToken("abd"))
  })
})

describe("pkceChallengeS256", () => {
  it("matches the RFC 7636 appendix B test vector", () => {
    // https://www.rfc-editor.org/rfc/rfc7636#appendix-B
    expect(pkceChallengeS256("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe(
      "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
    )
  })

  it("is base64url with no padding", () => {
    expect(pkceChallengeS256(generateToken(32))).toMatch(/^[A-Za-z0-9_-]{43}$/)
  })
})

describe("timingSafeEqualHex", () => {
  it("compares equal values as equal", () => {
    expect(timingSafeEqualHex("deadbeef", "deadbeef")).toBe(true)
  })

  it("rejects different values and different lengths", () => {
    expect(timingSafeEqualHex("deadbeef", "deadbeee")).toBe(false)
    expect(timingSafeEqualHex("deadbeef", "deadbee")).toBe(false)
  })
})

describe("timingSafeEqualString", () => {
  it("compares equal strings of any length as equal", () => {
    expect(timingSafeEqualString("", "")).toBe(true)
    expect(timingSafeEqualString("a", "a")).toBe(true)
    expect(timingSafeEqualString("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM", "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM")).toBe(true)
  })

  it("rejects mismatched values, including prefix relationships", () => {
    // Hashing both sides first means a shared prefix must not compare equal.
    expect(timingSafeEqualString("abc", "abcd")).toBe(false)
    expect(timingSafeEqualString("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM", "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cN")).toBe(false)
  })
})
