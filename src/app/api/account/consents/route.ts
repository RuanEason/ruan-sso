import { NextResponse } from "next/server"

import { getSessionUser } from "@/lib/auth/session"
import { recordAudit } from "@/lib/audit/log"
import { prisma } from "@/lib/db"

/** Lists the applications the signed-in user has standing consent for. */
export async function GET() {
  const user = await getSessionUser()
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const consents = await prisma.consent.findMany({
    where: { userId: user.id },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      scopes: true,
      createdAt: true,
      updatedAt: true,
      client: { select: { clientId: true, name: true, status: true } },
    },
  })

  return NextResponse.json({
    consents: consents.map((c) => ({
      id: c.id,
      scopes: c.scopes,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
      clientId: c.client.clientId,
      clientName: c.client.name,
      clientStatus: c.client.status,
    })),
  })
}

/**
 * Withdraws consent for one application.
 *
 * This is what keeps denial reachable once consent can be skipped: without it,
 * a user who ever clicked "allow" would be auto-approved on every later login
 * with no way back. Deleting the row makes the next authorization request fall
 * through to the consent screen again.
 */
export async function DELETE(request: Request) {
  const user = await getSessionUser()
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const clientId = new URL(request.url).searchParams.get("client_id")
  if (!clientId) {
    return NextResponse.json({ error: "client_id is required" }, { status: 400 })
  }

  // Scoped by userId so one user can never delete another's grant.
  const existing = await prisma.consent.findUnique({
    where: { userId_clientId: { userId: user.id, clientId } },
    select: { scopes: true, client: { select: { name: true } } },
  })

  const deleted = await prisma.consent.deleteMany({
    where: { userId: user.id, clientId },
  })
  if (deleted.count === 0) {
    return NextResponse.json({ error: "Consent not found" }, { status: 404 })
  }

  await recordAudit({
    action: "CONSENT_REVOKED",
    actor: user,
    targetType: "app",
    targetId: clientId,
    targetName: existing?.client.name,
    request,
    metadata: { scopes: existing?.scopes },
  })

  return NextResponse.json({ ok: true })
}
