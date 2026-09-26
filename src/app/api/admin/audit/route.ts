import { NextResponse } from "next/server"

import { requireAdmin } from "@/lib/auth/session"
import { listAuditLogs } from "@/lib/audit/query"
import { AUDIT_ACTIONS } from "@/lib/audit/actions"

export async function GET(request: Request) {
  try {
    await requireAdmin()
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const { searchParams } = new URL(request.url)
  const page = Number(searchParams.get("page") ?? "1")
  const pageSize = Number(searchParams.get("pageSize") ?? "")

  const result = await listAuditLogs(
    {
      action: searchParams.get("action"),
      actorId: searchParams.get("actorId"),
      targetType: searchParams.get("targetType"),
      targetId: searchParams.get("targetId"),
      page: Number.isFinite(page) ? page : 1,
      pageSize: Number.isFinite(pageSize) ? pageSize : undefined,
    },
    AUDIT_ACTIONS
  )

  return NextResponse.json(result)
}
