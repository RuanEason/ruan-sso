import { NextResponse } from "next/server"

import { destroySession, getSessionUser } from "@/lib/auth/session"
import { recordAudit } from "@/lib/audit/log"

export async function POST(request: Request) {
  // Read the user before destroying the session, or the trail would show a
  // logout by nobody.
  const user = await getSessionUser()
  await destroySession()
  if (user) {
    await recordAudit({
      action: "LOGOUT",
      actor: user,
      targetType: "user",
      targetId: user.id,
      targetName: user.username,
      request,
    })
  }
  return NextResponse.json({ ok: true })
}
