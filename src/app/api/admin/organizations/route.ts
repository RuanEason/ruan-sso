import { NextResponse } from "next/server"
import { z } from "zod"

import { requireAdmin } from "@/lib/auth/session"
import { recordAudit } from "@/lib/audit/log"
import { prisma } from "@/lib/db"

const createSchema = z.object({
  slug: z
    .string()
    .min(2)
    .max(64)
    .regex(/^[a-z0-9-]+$/, "slug 仅允许小写字母、数字与连字符"),
  name: z.string().min(1).max(128),
  description: z.string().max(2000).optional(),
  type: z.enum(["ENTERPRISE", "GROUP", "PUBLIC"]),
  allowSelfRegister: z.boolean().optional(),
})

export async function GET() {
  try {
    await requireAdmin()
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const organizations = await prisma.organization.findMany({
    orderBy: { createdAt: "asc" },
    include: {
      _count: { select: { members: true, clients: true } },
    },
  })

  return NextResponse.json({
    organizations: organizations.map((o) => ({
      id: o.id,
      slug: o.slug,
      name: o.name,
      description: o.description,
      type: o.type,
      status: o.status,
      allowSelfRegister: o.allowSelfRegister,
      memberCount: o._count.members,
      clientCount: o._count.clients,
      createdAt: o.createdAt,
    })),
  })
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

  const allowSelfRegister =
    parsed.data.allowSelfRegister ?? parsed.data.type === "PUBLIC"

  try {
    const organization = await prisma.organization.create({
      data: {
        slug: parsed.data.slug,
        name: parsed.data.name,
        description: parsed.data.description,
        type: parsed.data.type,
        allowSelfRegister,
      },
    })
    await recordAudit({
      action: "ADMIN_ORG_CREATED",
      actor: admin,
      targetType: "organization",
      targetId: organization.id,
      targetName: organization.name,
      request,
      // allowSelfRegister decides who can join without approval, so it is part
      // of the security-relevant record.
      metadata: { type: organization.type, allowSelfRegister },
    })
    return NextResponse.json({ organization }, { status: 201 })
  } catch {
    return NextResponse.json({ error: "组织 slug 已存在" }, { status: 409 })
  }
}
