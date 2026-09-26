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
