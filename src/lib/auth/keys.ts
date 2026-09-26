import {
  calculateJwkThumbprint,
  exportJWK,
  importJWK,
  importPKCS8,
  importSPKI,
  type JWK,
  type KeyObject,
} from "jose"

import { prisma } from "@/lib/db"
import { getJwtPrivateKeyPem, getJwtPublicKeyPem } from "@/lib/env"

/**
 * Signing key management.
 *
 * RUAN signs tokens with RS256. The private key is supplied out-of-band through
 * `JWT_PRIVATE_KEY_PEM` and never reaches the database or any client; the public
 * key is published at `/.well-known/jwks.json`. Relying parties verify tokens
 * using only that public key, so no shared secret is ever distributed — a
 * symmetric (HS256) design would let any single client forge tokens for every
 * other client and every user.
 *
 * The public key is mirrored into the `SigningKey` table so that (a) tokens can
 * be matched to a key by `kid` during rotation, and (b) retired keys remain
 * available to verify already-issued tokens.
 */

export type SigningKey = {
  kid: string
  alg: "RS256"
  privateKey: KeyObject
}

/** RFC 7638 JWK thumbprint, used as a stable, collision-resistant `kid`. */
export async function computeKid(publicKey: KeyObject): Promise<string> {
  const jwk = await exportJWK(publicKey)
  return calculateJwkThumbprint(jwk)
}

/**
 * Loads the configured keypair and returns it ready for signing.
 *
 * Throws when the key material is absent or malformed. This is deliberate: a
 * silent fallback to a weaker algorithm would leave the deployment looking
 * secure while signing with a shared secret.
 */
export async function loadSigningKey(): Promise<SigningKey> {
  const privatePem = getJwtPrivateKeyPem()
  const publicPem = getJwtPublicKeyPem()

  let privateKey: KeyObject
  try {
    privateKey = await importPKCS8(privatePem, "RS256")
  } catch (cause) {
    throw new Error(
      "JWT_PRIVATE_KEY_PEM is not a valid PKCS#8 RSA private key. " +
        "Run `npm run keys:generate` to create a keypair.",
      { cause }
    )
  }

  let publicKey: KeyObject
  try {
    publicKey = await importSPKI(publicPem, "RS256")
  } catch (cause) {
    throw new Error(
      "JWT_PUBLIC_KEY_PEM is not a valid SPKI RSA public key. " +
        "Run `npm run keys:generate` to create a keypair.",
      { cause }
    )
  }

  return { kid: await computeKid(publicKey), alg: "RS256", privateKey }
}

/**
 * Registers the configured public key in the database so it can be discovered
 * during verification and audited during rotation. Idempotent.
 */
export async function ensureSigningKeyRegistered(kid: string): Promise<void> {
  const publicJwk = await getPublicJwk()
  await prisma.signingKey.upsert({
    where: { kid },
    update: { publicJwk: publicJwk as object },
    create: { kid, alg: "RS256", publicJwk: publicJwk as object, status: "ACTIVE" },
  })
}

/** The public half of the configured keypair, as a JWK with no private members. */
export async function getPublicJwk(): Promise<JWK> {
  const publicKey = await importSPKI(getJwtPublicKeyPem(), "RS256")
  const jwk = await exportJWK(publicKey)

  // exportJWK on a public key yields public members only, but rebuild from an
  // explicit allowlist so a private member can never leak into the JWKS output.
  const { kty, n, e } = jwk as JWK & { n?: string; e?: string }
  if (!n || !e) {
    throw new Error("JWT_PUBLIC_KEY_PEM does not describe an RSA public key")
  }

  return {
    kty: kty ?? "RSA",
    n,
    e,
    kid: await computeKid(publicKey),
    alg: "RS256",
    use: "sig",
  }
}

/** The JWKS document served at /.well-known/jwks.json. */
export async function buildJwks(): Promise<{ keys: JWK[] }> {
  const current = await getPublicJwk()

  // Include retired keys so tokens issued before a rotation still verify.
  const retired = await prisma.signingKey.findMany({
    where: { status: "RETIRED" },
    select: { kid: true, alg: true, publicJwk: true },
  })

  const keys: JWK[] = [current]
  for (const key of retired) {
    if (key.kid === current.kid) continue
    keys.push({
      ...(key.publicJwk as JWK),
      kid: key.kid,
      alg: key.alg,
      use: "sig",
    })
  }

  return { keys }
}

/**
 * Resolves the key used to verify a token, by its `kid` header.
 *
 * Two distinct cases, deliberately handled differently:
 *
 *   - The token carries NO `kid`. It predates the introduction of `kid`, so
 *     there is nothing to look up; fall back to the configured key.
 *   - The token carries a `kid`. It MUST be found in the registry, which is the
 *     authoritative record of every key that may legitimately have signed a
 *     token. An unknown `kid` is rejected even if it happens to match the
 *     currently configured key, so that swapping `JWT_PUBLIC_KEY_PEM` without
 *     registering the key cannot silently bring an unregistered key into use.
 *
 * Returns null when the `kid` is not a key this deployment ever published.
 */
export async function resolveVerifyKey(kid?: string): Promise<KeyObject | null> {
  if (!kid) {
    return importSPKI(getJwtPublicKeyPem(), "RS256")
  }

  const stored = await prisma.signingKey.findUnique({ where: { kid } })
  if (!stored) return null

  return (await importJWK(stored.publicJwk as JWK, stored.alg)) as KeyObject
}
