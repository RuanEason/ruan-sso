import { NextResponse } from "next/server"
import { z } from "zod"

import { requireAdmin } from "@/lib/auth/session"
import { hashPassword } from "@/lib/auth/password"
import { recordAudit } from "@/lib/audit/log"
import { prisma } from "@/lib/db"

const createSchema = z.object({
  username: z.string().min(2).max(64),
  email: z.string().email(),
  displayName: z.string().min(1).max(128),
  password: z.string().min(6).max(128),
  role: z.enum(["ADMIN", "USER"]).default("USER"),
})

export async function GET() {
  try {
    await requireAdmin()
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const users = await prisma.user.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      username: true,
      email: true,
      displayName: true,
      role: true,
      status: true,
      createdAt: true,
    },
  })
  return NextResponse.json({ users })
}

export async function POST(request: Request) {
  let admin
  try {
    admin = await requireAdmin()
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const json = await request.json().catch(() => null)
  const parsed = createSchema.safeParse(json)
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 })
  }

  const passwordHash = await hashPassword(parsed.data.password)
  try {
    const user = await prisma.user.create({
      data: {
        username: parsed.data.username,
        email: parsed.data.email,
        displayName: parsed.data.displayName,
        passwordHash,
        role: parsed.data.role,
      },
      select: {
        id: true,
        username: true,
        email: true,
        displayName: true,
        role: true,
        status: true,
        createdAt: true,
      },
    })
    await recordAudit({
      action: "ADMIN_USER_CREATED",
      actor: admin,
      targetType: "user",
      targetId: user.id,
      targetName: user.username,
      request,
      // The role is worth recording: creating an ADMIN is the privilege
      // escalation an audit trail most needs to capture.
      metadata: { role: user.role },
    })
    return NextResponse.json({ user }, { status: 201 })
  } catch {
    return NextResponse.json({ error: "用户名或邮箱已存在" }, { status: 409 })
  }
}
