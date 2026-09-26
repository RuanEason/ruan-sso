import { NextResponse } from "next/server"
import { z } from "zod"

import { requireAdmin } from "@/lib/auth/session"
import { recordAudit } from "@/lib/audit/log"
import { prisma } from "@/lib/db"

const addSchema = z.object({
  userId: z.string().min(1).optional(),
  username: z.string().min(1).optional(),
  role: z.enum(["OWNER", "ADMIN", "MEMBER"]).default("MEMBER"),
})

type Ctx = { params: Promise<{ id: string }> }

export async function POST(request: Request, ctx: Ctx) {
  let admin
  try {
    admin = await requireAdmin()
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const { id: organizationId } = await ctx.params
  const org = await prisma.organization.findUnique({ where: { id: organizationId } })
  if (!org) {
    return NextResponse.json({ error: "组织不存在" }, { status: 404 })
  }

  const json = await request.json().catch(() => null)
  const parsed = addSchema.safeParse(json)
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 })
  }

  const user = parsed.data.userId
    ? await prisma.user.findUnique({ where: { id: parsed.data.userId } })
    : parsed.data.username
      ? await prisma.user.findUnique({ where: { username: parsed.data.username } })
      : null

  if (!user) {
    return NextResponse.json({ error: "用户不存在" }, { status: 404 })
  }

  try {
    const member = await prisma.organizationMember.create({
      data: {
        organizationId,
        userId: user.id,
        role: parsed.data.role,
      },
      include: {
        user: {
          select: {
            id: true,
            username: true,
            email: true,
            displayName: true,
            status: true,
          },
        },
      },
    })
    // Membership decides which OAuth clients a user may use, so both the
    // organization and the user are named in the record.
    await recordAudit({
      action: "ADMIN_MEMBER_ADDED",
      actor: admin,
      targetType: "organization",
      targetId: organizationId,
      targetName: org.name,
      request,
      metadata: { memberId: user.id, memberName: user.username, role: parsed.data.role },
    })
    return NextResponse.json({ member }, { status: 201 })
  } catch {
    return NextResponse.json({ error: "用户已在该组织中" }, { status: 409 })
  }
}

export async function DELETE(request: Request, ctx: Ctx) {
  let admin
  try {
    admin = await requireAdmin()
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const { id: organizationId } = await ctx.params
  const { searchParams } = new URL(request.url)
  const userId = searchParams.get("userId")
  if (!userId) {
    return NextResponse.json({ error: "userId required" }, { status: 400 })
  }

  const [org, user] = await Promise.all([
    prisma.organization.findUnique({ where: { id: organizationId }, select: { name: true } }),
    prisma.user.findUnique({ where: { id: userId }, select: { username: true } }),
  ])

  await prisma.organizationMember.deleteMany({
    where: { organizationId, userId },
  })

  await recordAudit({
    action: "ADMIN_MEMBER_REMOVED",
    actor: admin,
    targetType: "organization",
    targetId: organizationId,
    targetName: org?.name,
    request,
    metadata: { memberId: userId, memberName: user?.username },
  })

  return NextResponse.json({ ok: true })
}
