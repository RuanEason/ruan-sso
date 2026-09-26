import { describe, expect, it } from "vitest"
import { generateKeyPair, exportSPKI, importSPKI, calculateJwkThumbprint, exportJWK } from "jose"

import { computeKid } from "@/lib/auth/keys"

/**
 * `kid` is what makes rotation possible: it is the only thing linking a token to
 * the key that signed it. If `computeKid` were unstable, every restart would
 * look like a rotation and previously-issued tokens would stop resolving; if it
 * collided, two different keys would be indistinguishable during verification.
 *
 * These tests exercise the pure thumbprint logic only and deliberately touch no
 * database, matching the rest of the suite.
 */

/** A fresh 2048-bit RSA public key, exported as SPKI PEM. */
async function newPublicPem(): Promise<string> {
  const { publicKey } = await generateKeyPair("RS256", {
    extractable: true,
    modulusLength: 2048,
  })
  return exportSPKI(publicKey)
}

const asKeyObject = async (pem: string) => importSPKI(pem, "RS256")

describe("computeKid", () => {
  it("is stable for the same public key", async () => {
    const pem = await newPublicPem()
    const first = await computeKid(await asKeyObject(pem))
    const second = await computeKid(await asKeyObject(pem))
    expect(first).toBe(second)
  })

  it("is stable across separate KeyObjects imported from the same PEM", async () => {
    // A restart re-imports the key from the environment; the kid must not move.
    const pem = await newPublicPem()
    const a = await computeKid(await asKeyObject(pem))
    const b = await computeKid(await asKeyObject(pem))
    expect(a).toBe(b)
  })

  it("differs for different public keys", async () => {
    const kids = new Set<string>()
    for (let i = 0; i < 5; i++) {
      kids.add(await computeKid(await asKeyObject(await newPublicPem())))
    }
    expect(kids.size).toBe(5)
  })

  it("is a base64url string with no padding", async () => {
    const kid = await computeKid(await asKeyObject(await newPublicPem()))
    // SHA-256 -> 32 bytes -> 43 base64url chars.
    expect(kid).toMatch(/^[A-Za-z0-9_-]{43}$/)
  })

  it("matches the RFC 7638 JWK thumbprint", async () => {
    // Guards against a refactor silently changing the kid scheme, which would
    // orphan every token signed under the previous scheme.
    const pem = await newPublicPem()
    const key = await asKeyObject(pem)
    expect(await computeKid(key)).toBe(await calculateJwkThumbprint(await exportJWK(key)))
  })
})
