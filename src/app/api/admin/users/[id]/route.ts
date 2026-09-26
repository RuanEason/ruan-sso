import { NextResponse } from "next/server"
import { z } from "zod"

import { requireAdmin } from "@/lib/auth/session"
import { hashPassword } from "@/lib/auth/password"
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
  try {
    await requireAdmin()
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const { id } = await ctx.params
  const json = await request.json().catch(() => null)
  const parsed = patchSchema.safeParse(json)
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 })
  }

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
    return NextResponse.json({ user })
  } catch {
    return NextResponse.json({ error: "更新失败" }, { status: 400 })
  }
}

export async function DELETE(_request: Request, ctx: Ctx) {
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

  await prisma.user.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
