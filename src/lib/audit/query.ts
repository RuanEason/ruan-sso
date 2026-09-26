import type { AuditAction, Prisma } from "@prisma/client"

import { prisma } from "@/lib/db"

/** Page size for the audit view. Bounded so a caller cannot request everything. */
export const AUDIT_PAGE_SIZE = 50
export const AUDIT_MAX_PAGE_SIZE = 200

export type AuditQuery = {
  action?: string | null
  actorId?: string | null
  targetType?: string | null
  targetId?: string | null
  page?: number
  pageSize?: number
}

/**
 * Builds the Prisma filter for the audit list.
 *
 * Exported separately so the filtering rules (which values are honoured, how
 * paging is clamped) can be unit tested without a database.
 */
export function buildAuditWhere(
  query: AuditQuery,
  validActions: readonly string[]
): Prisma.AuditLogWhereInput {
  const where: Prisma.AuditLogWhereInput = {}
  // An unknown action string is ignored rather than matching nothing, so a
  // stale bookmark shows the unfiltered list instead of an empty page.
  if (query.action && validActions.includes(query.action)) {
    where.action = query.action as AuditAction
  }
  if (query.actorId) where.actorId = query.actorId
  if (query.targetType) where.targetType = query.targetType
  if (query.targetId) where.targetId = query.targetId
  return where
}

/** Clamps paging into a sane range: page >= 1, 1 <= pageSize <= max. */
export function normalizePaging(
  page: number | undefined,
  pageSize: number | undefined
): { page: number; pageSize: number; skip: number } {
  const safePage =
    Number.isFinite(page) && (page as number) > 0 ? Math.floor(page as number) : 1
  const rawSize =
    Number.isFinite(pageSize) && (pageSize as number) > 0
      ? Math.floor(pageSize as number)
      : AUDIT_PAGE_SIZE
  const safeSize = Math.min(rawSize, AUDIT_MAX_PAGE_SIZE)
  return { page: safePage, pageSize: safeSize, skip: (safePage - 1) * safeSize }
}

export async function listAuditLogs(
  query: AuditQuery,
  validActions: readonly string[]
) {
  const { page, pageSize, skip } = normalizePaging(query.page, query.pageSize)
  const where = buildAuditWhere(query, validActions)

  const [entries, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      // Newest first: the common question is "what just happened".
      orderBy: { createdAt: "desc" },
      skip,
      take: pageSize,
    }),
    prisma.auditLog.count({ where }),
  ])

  return { entries, total, page, pageSize }
}
