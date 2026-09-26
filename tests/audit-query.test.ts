import { describe, expect, it } from "vitest"

import { buildAuditWhere, normalizePaging } from "@/lib/audit/query"
import { AUDIT_ACTIONS, AUDIT_ACTION_LABELS, auditSeverity } from "@/lib/audit/actions"

const ACTIONS = ["LOGIN_SUCCESS", "LOGIN_FAILURE"] as const

describe("buildAuditWhere", () => {
  it("filters by a known action", () => {
    expect(buildAuditWhere({ action: "LOGIN_FAILURE" }, ACTIONS)).toEqual({
      action: "LOGIN_FAILURE",
    })
  })

  it("ignores an unknown action rather than matching nothing", () => {
    // A stale bookmark should show the unfiltered list, not an empty page that
    // looks like "no events happened".
    expect(buildAuditWhere({ action: "NOT_A_REAL_ACTION" }, ACTIONS)).toEqual({})
  })

  it("combines actor and target filters", () => {
    expect(
      buildAuditWhere(
        { actorId: "a1", targetType: "user", targetId: "u1" },
        ACTIONS
      )
    ).toEqual({ actorId: "a1", targetType: "user", targetId: "u1" })
  })

  it("produces an empty filter for no criteria", () => {
    expect(buildAuditWhere({}, ACTIONS)).toEqual({})
    expect(buildAuditWhere({ action: null, actorId: null }, ACTIONS)).toEqual({})
  })
})

describe("normalizePaging", () => {
  it("defaults to page 1 with the default size", () => {
    expect(normalizePaging(undefined, undefined)).toEqual({
      page: 1,
      pageSize: 50,
      skip: 0,
    })
  })

  it("computes skip from the page number", () => {
    expect(normalizePaging(3, 10)).toEqual({ page: 3, pageSize: 10, skip: 20 })
  })

  it("rejects nonsensical paging instead of trusting the caller", () => {
    expect(normalizePaging(0, undefined).page).toBe(1)
    expect(normalizePaging(-5, undefined).page).toBe(1)
    expect(normalizePaging(Number.NaN, undefined).page).toBe(1)
    expect(normalizePaging(1, 0).pageSize).toBe(50)
    expect(normalizePaging(1, Number.NaN).pageSize).toBe(50)
  })

  it("clamps page size so a caller cannot request the whole table", () => {
    expect(normalizePaging(1, 100000).pageSize).toBe(200)
  })
})

describe("audit action catalogue", () => {
  it("labels and actions stay in sync with the Prisma enum", () => {
    // The list is derived from the generated enum, so a new action cannot be
    // added to the schema without acquiring a label here.
    for (const action of AUDIT_ACTIONS) {
      expect(AUDIT_ACTION_LABELS[action], `missing label for ${action}`).toBeTruthy()
    }
    expect(Object.keys(AUDIT_ACTION_LABELS).sort()).toEqual([...AUDIT_ACTIONS].sort())
  })

  it("flags failures, destructive operations and successes distinctly", () => {
    expect(auditSeverity("LOGIN_FAILURE")).toBe("warning")
    expect(auditSeverity("LOGIN_BLOCKED")).toBe("warning")
    expect(auditSeverity("CONSENT_DENIED")).toBe("warning")
    expect(auditSeverity("ADMIN_USER_DELETED")).toBe("danger")
    expect(auditSeverity("ADMIN_MEMBER_REMOVED")).toBe("danger")
    expect(auditSeverity("LOGIN_SUCCESS")).toBe("success")
    expect(auditSeverity("TOKEN_ISSUED")).toBe("neutral")
  })
})
