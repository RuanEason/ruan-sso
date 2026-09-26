import type { AuditAction, Prisma, Role } from "@prisma/client"

import { prisma } from "@/lib/db"

/**
 * Append-only audit trail. Every write goes through `recordAudit` so that two
 * invariants hold everywhere rather than at each call site:
 *
 *  1. **No credentials are ever stored.** The trail is the most attractive
 *     table to dump; passwords, authorization codes, tokens and client secrets
 *     must never reach it. `redactMetadata` only allows scalar values and
 *     `assertWritable` refuses keys that look like secrets.
 *  2. **Audit failure never breaks the audited operation.** A failed login must
 *     still return 401, and a completed deletion must not roll back, even if
 *     the audit insert fails. Writes are best-effort and swallowed.
 */

/** Usernames and names are attacker-controlled on failure paths; bound them. */
export const MAX_FIELD_LENGTH = 128

/**
 * Keys whose values could be credentials. Rejected rather than stripped, so a
 * mistaken `metadata: { password }` is a loud failure in tests rather than a
 * silent secret leak in production.
 */
const FORBIDDEN_KEY = /pass|secret|token|code|hash|pem|key|credential|authorization/i

/** Scalar-only, length-bounded copy of `metadata`. */
export function redactMetadata(
  metadata: Record<string, unknown> | undefined
): Record<string, string | number | boolean | null> | undefined {
  if (!metadata) return undefined
  const out: Record<string, string | number | boolean | null> = {}
  for (const [key, value] of Object.entries(metadata)) {
    if (FORBIDDEN_KEY.test(key)) {
      throw new Error(`refusing to audit forbidden metadata key: ${key}`)
    }
    if (value === null) {
      out[key] = null
    } else if (typeof value === "string") {
      out[key] = truncate(value)
    } else if (typeof value === "number" || typeof value === "boolean") {
      out[key] = value
    } else if (Array.isArray(value)) {
      // Scope lists and similar; still scalar-bounded so nothing nests.
      out[key] = truncate(value.map((v) => String(v)).join(" "))
    } else {
      out[key] = "[omitted]"
    }
  }
  return out
}

/** Bounds untrusted input before it reaches a column. */
export function truncate(value: string, max = MAX_FIELD_LENGTH): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value
}

/** Extracts the client address the same way the login endpoint does. */
export function clientIp(request: Request): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown"
  )
}

export type AuditActor = {
  id: string
  username: string
  role: Role
}

export type AuditInput = {
  action: AuditAction
  actor?: AuditActor | null
  /** Overrides the actor's name, e.g. for a failed login naming who was tried. */
  actorName?: string | null
  targetType?: string
  targetId?: string
  targetName?: string
  request?: Request
  ip?: string
  userAgent?: string | null
  metadata?: Record<string, unknown>
}

function toJson(
  metadata: Record<string, string | number | boolean | null> | undefined
): Prisma.InputJsonValue | undefined {
  return metadata as Prisma.InputJsonValue | undefined
}

/**
 * Records one audit event. Never throws: a failure to audit must not fail the
 * operation being audited (or a login would become impossible because the log
 * table is full).
 */
export async function recordAudit(input: AuditInput): Promise<void> {
  try {
    const metadata = redactMetadata(input.metadata)
    await prisma.auditLog.create({
      data: {
        action: input.action,
        actorId: input.actor?.id ?? null,
        // Snapshot, so the row stays readable after the user row is deleted.
        actorName: input.actorName
          ? truncate(input.actorName)
          : (input.actor?.username ?? null),
        actorRole: input.actor?.role ?? null,
        targetType: input.targetType ?? null,
        targetId: input.targetId ?? null,
        targetName: input.targetName ? truncate(input.targetName) : null,
        ip: input.ip ?? (input.request ? clientIp(input.request) : null),
        userAgent:
          input.userAgent ?? input.request?.headers.get("user-agent") ?? null,
        metadata: toJson(metadata),
      },
    })
  } catch (error) {
    // Deliberately swallowed and logged to stderr only. The alternative —
    // propagating — would let an audit outage block authentication entirely.
    console.error(
      `[audit] failed to record ${input.action}:`,
      error instanceof Error ? error.message : String(error)
    )
  }
}
