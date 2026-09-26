import { SignJWT, jwtVerify } from "jose"
import type { User } from "@prisma/client"

import { getAppUrl, getJwtSecret, ACCESS_TOKEN_TTL_SEC, allowHs256 } from "@/lib/env"
import { loadSigningKey, resolveVerifyKey } from "@/lib/auth/keys"

export type AccessTokenPayload = {
  sub: string
  client_id: string
  scope: string
  typ: "access"
}

/**
 * `at_hash`: the base64url-encoded left half of the SHA-256 digest of the
 * access token, per OIDC Core 3.1.3.6. It binds the id_token to the specific
 * access token issued alongside it, so a client can detect a mismatched pair.
 */
async function computeAtHash(accessToken: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(accessToken)
  )
  return Buffer.from(digest).subarray(0, digest.byteLength / 2).toString("base64url")
}

export async function signAccessToken(input: {
  userId: string
  clientId: string
  scopes: string
}): Promise<string> {
  const { kid, privateKey } = await loadSigningKey()
  return new SignJWT({
    client_id: input.clientId,
    scope: input.scopes,
    typ: "access",
  })
    .setProtectedHeader({ alg: "RS256", kid })
    .setSubject(input.userId)
    .setIssuer(getAppUrl())
    .setAudience(input.clientId)
    .setIssuedAt()
    .setExpirationTime(`${ACCESS_TOKEN_TTL_SEC}s`)
    .sign(privateKey)
}

export async function signIdToken(input: {
  user: Pick<User, "id" | "username" | "email" | "displayName">
  clientId: string
  scopes: string
  nonce?: string | null
  /** The access token issued in the same response, for `at_hash` binding. */
  accessToken?: string
  /** When the end-user authenticated, per OIDC Core 2. */
  authTime?: Date
}): Promise<string> {
  const { kid, privateKey } = await loadSigningKey()
  const claims: Record<string, unknown> = {}
  const scopes = input.scopes.split(/\s+/).filter(Boolean)

  if (scopes.includes("profile")) {
    claims.name = input.user.displayName
    claims.preferred_username = input.user.username
  }
  if (scopes.includes("email")) {
    claims.email = input.user.email
    claims.email_verified = true
  }
  if (input.nonce) {
    claims.nonce = input.nonce
  }

  claims.auth_time = Math.floor((input.authTime ?? new Date()).getTime() / 1000)

  if (input.accessToken) {
    claims.at_hash = await computeAtHash(input.accessToken)
  }

  return new SignJWT(claims)
    .setProtectedHeader({ alg: "RS256", kid })
    .setSubject(input.user.id)
    .setIssuer(getAppUrl())
    .setAudience(input.clientId)
    .setIssuedAt()
    .setExpirationTime(`${ACCESS_TOKEN_TTL_SEC}s`)
    .sign(privateKey)
}

export async function verifyAccessToken(
  token: string
): Promise<AccessTokenPayload | null> {
  try {
    const { payload } = await jwtVerify(
      token,
      async (protectedHeader) => {
        // HS256 is accepted only while the transitional flag is on, so existing
        // relying parties keep working during migration. Off by default.
        if (protectedHeader.alg === "HS256") {
          if (!allowHs256()) {
            throw new Error("HS256 tokens are no longer accepted")
          }
          return getJwtSecret()
        }
        const key = await resolveVerifyKey(protectedHeader.kid)
        if (!key) throw new Error("Unknown signing key")
        return key
      },
      { issuer: getAppUrl(), algorithms: allowHs256() ? ["RS256", "HS256"] : ["RS256"] }
    )
    if (payload.typ !== "access" || typeof payload.sub !== "string") {
      return null
    }
    return {
      sub: payload.sub,
      client_id: String(payload.client_id ?? ""),
      scope: String(payload.scope ?? ""),
      typ: "access",
    }
  } catch {
    return null
  }
}
