import { createHash, randomBytes } from "crypto"

export function generateToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url")
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex")
}

export function pkceChallengeS256(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url")
}

export function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let out = 0
  for (let i = 0; i < a.length; i++) {
    out |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return out === 0
}

/**
 * Constant-time comparison for two base64url strings of any length.
 *
 * Both sides are hashed first so the comparison runs over equal-length digests;
 * comparing raw values would leak length mismatches through an early return.
 * Used for PKCE challenge checks, where a timing oracle would let an attacker
 * recover a valid `code_challenge` byte by byte.
 */
export function timingSafeEqualString(a: string, b: string): boolean {
  const da = createHash("sha256").update(a).digest()
  const db = createHash("sha256").update(b).digest()
  return timingSafeEqualHex(da.toString("hex"), db.toString("hex"))
}
