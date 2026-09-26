import { NextResponse } from "next/server"

import {
  listUserSessions,
  requireAdmin,
  revokeSession,
  getSessionUser,
} from "@/lib/auth/session"
import { recordAudit } from "@/lib/audit/log"

export async function GET() {
  try {
    await requireAdmin()
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const user = await getSessionUser()
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const sessions = await listUserSessions(user.id)
  return NextResponse.json({ sessions })
}

export async function DELETE(request: Request) {
  let admin
  try {
    admin = await requireAdmin()
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const user = await getSessionUser()
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const id = searchParams.get("id")
  if (!id) {
    return NextResponse.json({ error: "id required" }, { status: 400 })
  }

  await revokeSession(id, user.id)

  await recordAudit({
    action: "ADMIN_SESSION_REVOKED",
    actor: admin,
    targetType: "session",
    targetId: id,
    request,
  })

  return NextResponse.json({ ok: true })
}
