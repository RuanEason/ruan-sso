import { NextResponse } from "next/server"
import { z } from "zod"

import { requireAdmin } from "@/lib/auth/session"
import { prisma } from "@/lib/db"

const addSchema = z.object({
  userId: z.string().min(1).optional(),
  username: z.string().min(1).optional(),
  role: z.enum(["OWNER", "ADMIN", "MEMBER"]).default("MEMBER"),
})

type Ctx = { params: Promise<{ id: string }> }

export async function POST(request: Request, ctx: Ctx) {
  try {
    await requireAdmin()
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
    return NextResponse.json({ member }, { status: 201 })
  } catch {
    return NextResponse.json({ error: "用户已在该组织中" }, { status: 409 })
  }
}

export async function DELETE(request: Request, ctx: Ctx) {
  try {
    await requireAdmin()
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const { id: organizationId } = await ctx.params
  const { searchParams } = new URL(request.url)
  const userId = searchParams.get("userId")
  if (!userId) {
    return NextResponse.json({ error: "userId required" }, { status: 400 })
  }

  await prisma.organizationMember.deleteMany({
    where: { organizationId, userId },
  })
  return NextResponse.json({ ok: true })
}
