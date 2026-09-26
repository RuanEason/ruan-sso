import { NextResponse } from "next/server"

import { verifyAccessToken } from "@/lib/auth/jwt"
import { prisma } from "@/lib/db"

export async function GET(request: Request) {
  const header = request.headers.get("authorization")
  if (!header?.startsWith("Bearer ")) {
    return NextResponse.json({ error: "invalid_token" }, { status: 401 })
  }
  const token = header.slice(7)
  const payload = await verifyAccessToken(token)
  if (!payload) {
    return NextResponse.json({ error: "invalid_token" }, { status: 401 })
  }

  const user = await prisma.user.findUnique({ where: { id: payload.sub } })
  if (!user || user.status !== "ACTIVE") {
    return NextResponse.json({ error: "invalid_token" }, { status: 401 })
  }

  const scopes = new Set(payload.scope.split(/\s+/).filter(Boolean))
  const claims: Record<string, unknown> = { sub: user.id }
  if (scopes.has("profile")) {
    claims.name = user.displayName
    claims.preferred_username = user.username
  }
  if (scopes.has("email")) {
    claims.email = user.email
    claims.email_verified = true
  }

  return NextResponse.json(claims)
}
