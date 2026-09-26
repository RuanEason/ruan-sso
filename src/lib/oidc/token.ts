import { prisma } from "@/lib/db"
import { generateToken, hashToken, pkceChallengeS256, timingSafeEqualString } from "@/lib/crypto"
import {
  AUTH_CODE_TTL_MS,
  ACCESS_TOKEN_TTL_SEC,
  REFRESH_TOKEN_TTL_MS,
} from "@/lib/env"
import { signAccessToken, signIdToken } from "@/lib/auth/jwt"
import { verifyPassword } from "@/lib/auth/password"
import { parseRedirectUris } from "@/lib/oidc/validate"

export async function issueAuthorizationCode(input: {
  clientId: string
  userId: string
  redirectUri: string
  scopes: string
  codeChallenge: string
  codeChallengeMethod: string
  nonce?: string | null
}): Promise<string> {
  const code = generateToken(32)
  await prisma.authorizationCode.create({
    data: {
      codeHash: hashToken(code),
      clientId: input.clientId,
      userId: input.userId,
      redirectUri: input.redirectUri,
      scopes: input.scopes,
      codeChallenge: input.codeChallenge,
      codeChallengeMethod: input.codeChallengeMethod,
      nonce: input.nonce ?? null,
      expiresAt: new Date(Date.now() + AUTH_CODE_TTL_MS),
    },
  })
  return code
}

export async function exchangeAuthorizationCode(input: {
  code: string
  clientId: string
  clientSecret?: string | null
  redirectUri: string
  codeVerifier: string
}) {
  const client = await prisma.oAuthClient.findUnique({
    where: { clientId: input.clientId },
  })
  if (!client || client.status !== "ACTIVE") {
    return { error: "invalid_client" as const, description: "Unknown client" }
  }

  if (client.isConfidential) {
    if (!input.clientSecret || !client.clientSecretHash) {
      return { error: "invalid_client" as const, description: "client_secret required" }
    }
    const ok = await verifyPassword(input.clientSecret, client.clientSecretHash)
    if (!ok) {
      return { error: "invalid_client" as const, description: "Invalid client credentials" }
    }
  }

  const redirectUris = parseRedirectUris(client.redirectUris)
  if (!redirectUris.includes(input.redirectUri)) {
    return { error: "invalid_grant" as const, description: "redirect_uri mismatch" }
  }

  const record = await prisma.authorizationCode.findUnique({
    where: { codeHash: hashToken(input.code) },
    include: { user: true },
  })

  if (!record || record.usedAt || record.expiresAt < new Date()) {
    return { error: "invalid_grant" as const, description: "Invalid or expired code" }
  }
  if (record.clientId !== input.clientId || record.redirectUri !== input.redirectUri) {
    return { error: "invalid_grant" as const, description: "Code mismatch" }
  }

  const expected = pkceChallengeS256(input.codeVerifier)
  if (!timingSafeEqualString(expected, record.codeChallenge)) {
    return { error: "invalid_grant" as const, description: "PKCE verification failed" }
  }

  // Redeem the code atomically. A read-then-write would let two concurrent
  // requests both observe `usedAt: null` and each mint a token from the same
  // code; the conditional update guarantees exactly one winner.
  const redeemed = await prisma.authorizationCode.updateMany({
    where: { id: record.id, usedAt: null },
    data: { usedAt: new Date() },
  })
  if (redeemed.count === 0) {
    return { error: "invalid_grant" as const, description: "Code already used" }
  }

  if (record.user.status !== "ACTIVE") {
    return { error: "invalid_grant" as const, description: "User disabled" }
  }

  const accessToken = await signAccessToken({
    userId: record.userId,
    clientId: input.clientId,
    scopes: record.scopes,
  })
  const idToken = await signIdToken({
    user: record.user,
    clientId: input.clientId,
    scopes: record.scopes,
    nonce: record.nonce,
    accessToken,
    authTime: record.createdAt,
  })

  const refreshPlain = generateToken(32)
  await prisma.refreshToken.create({
    data: {
      tokenHash: hashToken(refreshPlain),
      clientId: input.clientId,
      userId: record.userId,
      scopes: record.scopes,
      expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
    },
  })

  return {
    access_token: accessToken,
    token_type: "Bearer",
    expires_in: ACCESS_TOKEN_TTL_SEC,
    refresh_token: refreshPlain,
    id_token: idToken,
    scope: record.scopes,
  }
}

export async function exchangeRefreshToken(input: {
  refreshToken: string
  clientId: string
  clientSecret?: string | null
}) {
  const client = await prisma.oAuthClient.findUnique({
    where: { clientId: input.clientId },
  })
  if (!client || client.status !== "ACTIVE") {
    return { error: "invalid_client" as const, description: "Unknown client" }
  }
  if (client.isConfidential) {
    if (!input.clientSecret || !client.clientSecretHash) {
      return { error: "invalid_client" as const, description: "client_secret required" }
    }
    const ok = await verifyPassword(input.clientSecret, client.clientSecretHash)
    if (!ok) {
      return { error: "invalid_client" as const, description: "Invalid client credentials" }
    }
  }

  const record = await prisma.refreshToken.findUnique({
    where: { tokenHash: hashToken(input.refreshToken) },
    include: { user: true },
  })
  if (
    !record ||
    record.revokedAt ||
    record.expiresAt < new Date() ||
    record.clientId !== input.clientId
  ) {
    return { error: "invalid_grant" as const, description: "Invalid refresh token" }
  }
  if (record.user.status !== "ACTIVE") {
    return { error: "invalid_grant" as const, description: "User disabled" }
  }

  // Rotate atomically: concurrent refreshes with the same token must not each
  // mint a new refresh token, which would leave orphaned live tokens behind.
  const rotated = await prisma.refreshToken.updateMany({
    where: { id: record.id, revokedAt: null },
    data: { revokedAt: new Date() },
  })
  if (rotated.count === 0) {
    return { error: "invalid_grant" as const, description: "Refresh token already used" }
  }

  const accessToken = await signAccessToken({
    userId: record.userId,
    clientId: input.clientId,
    scopes: record.scopes,
  })
  const idToken = await signIdToken({
    user: record.user,
    clientId: input.clientId,
    scopes: record.scopes,
    accessToken,
    authTime: record.createdAt,
  })
  const refreshPlain = generateToken(32)
  await prisma.refreshToken.create({
    data: {
      tokenHash: hashToken(refreshPlain),
      clientId: input.clientId,
      userId: record.userId,
      scopes: record.scopes,
      expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
    },
  })

  return {
    access_token: accessToken,
    token_type: "Bearer",
    expires_in: ACCESS_TOKEN_TTL_SEC,
    refresh_token: refreshPlain,
    id_token: idToken,
    scope: record.scopes,
  }
}
