import { NextResponse } from "next/server"
import { z } from "zod"

import { requireAdmin } from "@/lib/auth/session"
import { hashPassword } from "@/lib/auth/password"
import { recordAudit } from "@/lib/audit/log"
import { prisma } from "@/lib/db"

const patchSchema = z.object({
  displayName: z.string().min(1).max(128).optional(),
  email: z.string().email().optional(),
  role: z.enum(["ADMIN", "USER"]).optional(),
  status: z.enum(["ACTIVE", "DISABLED"]).optional(),
  password: z.string().min(6).max(128).optional(),
})

type Ctx = { params: Promise<{ id: string }> }

export async function PATCH(request: Request, ctx: Ctx) {
  let admin
  try {
    admin = await requireAdmin()
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const { id } = await ctx.params
  const json = await request.json().catch(() => null)
  const parsed = patchSchema.safeParse(json)
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 })
  }

  const previous = await prisma.user.findUnique({
    where: { id },
    select: { role: true, status: true, username: true },
  })

  const data: Record<string, unknown> = { ...parsed.data }
  if (parsed.data.password) {
    data.passwordHash = await hashPassword(parsed.data.password)
    delete data.password
  }

  try {
    const user = await prisma.user.update({
      where: { id },
      data,
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

    // Only the field NAMES are recorded, never their values: this is where a
    // password reset would otherwise leak a credential into the trail.
    const changed = Object.keys(parsed.data)
    await recordAudit({
      action: "ADMIN_USER_UPDATED",
      actor: admin,
      targetType: "user",
      targetId: user.id,
      targetName: user.username,
      request,
      metadata: {
        changed,
        // Role transitions are called out explicitly: they are the privilege
        // changes an investigator looks for first.
        ...(previous && previous.role !== user.role
          ? { roleFrom: previous.role, roleTo: user.role }
          : {}),
        ...(previous && previous.status !== user.status
          ? { statusFrom: previous.status, statusTo: user.status }
          : {}),
      },
    })

    return NextResponse.json({ user })
  } catch {
    return NextResponse.json({ error: "更新失败" }, { status: 400 })
  }
}

export async function DELETE(request: Request, ctx: Ctx) {
  let admin
  try {
    admin = await requireAdmin()
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const { id } = await ctx.params
  if (admin.id === id) {
    return NextResponse.json({ error: "不能删除当前登录账号" }, { status: 400 })
  }

  // Snapshot the identity before deleting: the cascade takes the user row, so
  // this is the last moment the name can be captured for the trail.
  const target = await prisma.user.findUnique({
    where: { id },
    select: { username: true, role: true },
  })

  await prisma.user.delete({ where: { id } })

  await recordAudit({
    action: "ADMIN_USER_DELETED",
    actor: admin,
    targetType: "user",
    targetId: id,
    targetName: target?.username,
    request,
    metadata: { deletedRole: target?.role },
  })

  return NextResponse.json({ ok: true })
}
