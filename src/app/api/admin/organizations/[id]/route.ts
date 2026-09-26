import { NextResponse } from "next/server"
import { z } from "zod"

import { requireAdmin } from "@/lib/auth/session"
import { prisma } from "@/lib/db"

const patchSchema = z.object({
  name: z.string().min(1).max(128).optional(),
  description: z.string().max(2000).nullable().optional(),
  status: z.enum(["ACTIVE", "DISABLED"]).optional(),
  allowSelfRegister: z.boolean().optional(),
})

type Ctx = { params: Promise<{ id: string }> }

export async function GET(_request: Request, ctx: Ctx) {
  try {
    await requireAdmin()
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const { id } = await ctx.params
  const organization = await prisma.organization.findUnique({
    where: { id },
    include: {
      members: {
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
        orderBy: { createdAt: "asc" },
      },
    },
  })

  if (!organization) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  return NextResponse.json({ organization })
}

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

  const organization = await prisma.organization.update({
    where: { id },
    data: parsed.data,
  })
  return NextResponse.json({ organization })
}

export async function DELETE(_request: Request, ctx: Ctx) {
  try {
    await requireAdmin()
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const { id } = await ctx.params
  await prisma.organization.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
