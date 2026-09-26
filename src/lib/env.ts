export function getAppUrl(): string {
  return (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "")
}

export function getSessionSecret(): string {
  const secret = process.env.SESSION_SECRET
  if (!secret || secret.length < 16) {
    throw new Error("SESSION_SECRET must be set (min 16 chars)")
  }
  return secret
}

export function getJwtSecret(): Uint8Array {
  const secret = process.env.JWT_SECRET
  if (!secret || secret.length < 16) {
    throw new Error("JWT_SECRET must be set (min 16 chars)")
  }
  return new TextEncoder().encode(secret)
}

/**
 * PEM values in .env are single-line with literal `\n` escapes (multi-line
 * values are not portable across shells and dotenv implementations), so they
 * are unescaped here.
 */
function readPem(name: string): string {
  const raw = process.env[name]
  if (!raw || !raw.trim()) {
    throw new Error(
      `${name} must be set. Run \`npm run keys:generate\` to create an RS256 keypair.`
    )
  }
  const pem = raw.includes("\\n") ? raw.replace(/\\n/g, "\n") : raw
  if (!pem.includes("-----BEGIN")) {
    throw new Error(`${name} does not look like a PEM-encoded key`)
  }
  return pem
}

export function getJwtPrivateKeyPem(): string {
  return readPem("JWT_PRIVATE_KEY_PEM")
}

export function getJwtPublicKeyPem(): string {
  return readPem("JWT_PUBLIC_KEY_PEM")
}

/**
 * Transitional escape hatch for relying parties that still verify with the
 * shared HS256 `JWT_SECRET`. Defaults to false; once it is enabled the
 * discovery document must advertise HS256 too, or the docs would claim a
 * capability the server does not honour.
 */
export function allowHs256(): boolean {
  return process.env.JWT_ALLOW_HS256 === "true"
}

export const SESSION_COOKIE = "ruan_session"
export const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7 // 7 days
export const AUTH_CODE_TTL_MS = 1000 * 60 * 10 // 10 minutes
export const ACCESS_TOKEN_TTL_SEC = 60 * 60 // 1 hour
export const REFRESH_TOKEN_TTL_MS = 1000 * 60 * 60 * 24 * 30 // 30 days
export const DEFAULT_SCOPES = ["openid", "profile", "email"] as const
