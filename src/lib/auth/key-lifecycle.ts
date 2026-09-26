/**
 * Key lifecycle policy, kept as pure functions so it can be unit tested without
 * a database.
 *
 * A signed token remains verifiable until it expires, so a key may only be
 * deleted once every token it could have signed has expired. `ACCESS_TOKEN_TTL_SEC`
 * (1 hour) is the longest such lifetime for a token this service signs, which
 * makes `retiredAt + 1h` the earliest safe deletion time.
 *
 * Lives in src/ rather than in scripts/ so it is covered by the same test setup
 * as the rest of the security-critical logic; scripts/prune-keys.mjs imports it.
 */

/** Must match ACCESS_TOKEN_TTL_SEC in src/lib/env.ts. */
export const TOKEN_TTL_MS = 60 * 60 * 1000

export type RetiredKeyRow = {
  kid: string
  status: string
  retiredAt: Date | null
}

export type EligibleKey<T extends RetiredKeyRow> = T & { deletableAt: Date }
export type DeferredKey<T extends RetiredKeyRow> = T & { deletableAt?: Date; reason: string }

/**
 * Splits rows into those safe to delete and those still inside the grace
 * period. Rows that are not RETIRED are ignored entirely: ACTIVE keys are never
 * eligible for deletion, under any circumstance.
 */
export function partitionRetiredKeys<T extends RetiredKeyRow>(
  rows: readonly T[],
  now: Date,
  ttlMs: number = TOKEN_TTL_MS
): { eligible: EligibleKey<T>[]; tooEarly: DeferredKey<T>[] } {
  const eligible: EligibleKey<T>[] = []
  const tooEarly: DeferredKey<T>[] = []

  for (const row of rows) {
    if (row.status !== "RETIRED") continue

    // A RETIRED row with no timestamp cannot be shown to be expired. Treat it as
    // too early rather than guessing: deleting it could invalidate live tokens.
    if (!row.retiredAt) {
      tooEarly.push({ ...row, reason: "no retiredAt recorded" })
      continue
    }

    const deletableAt = new Date(row.retiredAt.getTime() + ttlMs)
    if (deletableAt <= now) {
      eligible.push({ ...row, deletableAt })
    } else {
      tooEarly.push({ ...row, deletableAt, reason: "still inside the grace period" })
    }
  }

  return { eligible, tooEarly }
}

export type KeyHealthInput = {
  /** kid derived from JWT_PUBLIC_KEY_PEM, or null when the PEM is unreadable. */
  envKid: string | null
  /** Every SigningKey row, in any status. */
  rows: readonly RetiredKeyRow[]
  /** kids present in the JWKS document that buildJwks() produces. */
  jwksKids: readonly string[]
  now: Date
  ttlMs?: number
}

export type KeyHealthIssue = {
  /** Machine-readable id, so callers can distinguish severity without parsing. */
  code:
    | "no-active-key"
    | "multiple-active-keys"
    | "env-key-not-registered"
    | "active-key-not-published"
    | "retired-key-not-published"
    | "stale-retired-keys"
  severity: "error" | "warning"
  message: string
}

/**
 * Audits the three things that must agree for signing to work: the key in the
 * environment, the registry, and the published JWKS.
 *
 * This exists because those can drift in a way that is invisible until a relying
 * party rejects a token: editing .env without restarting publishes one key while
 * the process signs with another, and rotating without redeploying the new
 * environment leaves the registry ahead of the running server.
 *
 * Pure: the caller supplies everything, including `now`. No database, no env.
 */
export function auditKeyHealth(input: KeyHealthInput): KeyHealthIssue[] {
  const ttl = input.ttlMs ?? TOKEN_TTL_MS
  const issues: KeyHealthIssue[] = []

  const active = input.rows.filter((row) => row.status === "ACTIVE")
  const retired = input.rows.filter((row) => row.status === "RETIRED")
  const published = new Set(input.jwksKids)

  // Exactly one ACTIVE key. Zero means nothing can be traced as the signer;
  // more than one means a previous rotation did not retire its predecessor.
  if (active.length === 0) {
    issues.push({
      code: "no-active-key",
      severity: "error",
      message:
        "No ACTIVE key in SigningKey. The deployment has no registered signer; " +
        "run `npm run keys:rotate` or `npm run db:seed` to register one.",
    })
  } else if (active.length > 1) {
    issues.push({
      code: "multiple-active-keys",
      severity: "error",
      message:
        `${active.length} ACTIVE keys in SigningKey (${active.map((r) => r.kid).join(", ")}). ` +
        "Only one key should be ACTIVE; retire the stale ones with `npm run keys:rotate`.",
    })
  }

  // The environment key must be the registered signer. This is the drift that
  // masks itself: the server signs with the env key while the registry says
  // otherwise, and only relying parties ever notice.
  if (input.envKid === null) {
    issues.push({
      code: "env-key-not-registered",
      severity: "error",
      message: "JWT_PUBLIC_KEY_PEM is missing or malformed; cannot derive a kid.",
    })
  } else if (!active.some((row) => row.kid === input.envKid)) {
    issues.push({
      code: "env-key-not-registered",
      severity: "error",
      message:
        `The key in the environment (kid=${input.envKid}) is not registered as ACTIVE. ` +
        "The server would sign tokens that the registry does not recognise. " +
        "Rotate, or restart after deploying the matching environment.",
    })
  }

  // Everything the registry says may legitimately verify must be published, or
  // tokens signed with it cannot be checked by relying parties.
  for (const row of active) {
    if (!published.has(row.kid)) {
      issues.push({
        code: "active-key-not-published",
        severity: "error",
        message: `ACTIVE key ${row.kid} is missing from the JWKS. Tokens it signs cannot be verified.`,
      })
    }
  }

  const { eligible, tooEarly } = partitionRetiredKeys(retired, input.now, ttl)
  for (const row of retired) {
    // Retired keys must stay published for their whole grace period, otherwise
    // tokens issued just before the rotation stop verifying too early.
    const stillNeeded = tooEarly.some((deferred) => deferred.kid === row.kid)
    if (stillNeeded && !published.has(row.kid)) {
      issues.push({
        code: "retired-key-not-published",
        severity: "error",
        message:
          `RETIRED key ${row.kid} is still inside its grace period but is not in the JWKS. ` +
          "Tokens signed with it will fail to verify.",
      })
    }
  }

  if (eligible.length > 0) {
    issues.push({
      code: "stale-retired-keys",
      severity: "warning",
      message:
        `${eligible.length} RETIRED key(s) are past their grace period and can be removed: ` +
        `${eligible.map((r) => r.kid).join(", ")}. Run \`npm run keys:prune -- --apply\`.`,
    })
  }

  return issues
}
