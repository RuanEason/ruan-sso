import { NextResponse } from "next/server"
import { z } from "zod"

import { requireAdmin } from "@/lib/auth/session"
import { prisma } from "@/lib/db"

const patchSchema = z
  .object({
    name: z.string().min(1).max(128).optional(),
    redirectUris: z.array(z.string().url()).min(1).optional(),
    allowedScopes: z.string().optional(),
    status: z.enum(["ACTIVE", "DISABLED"]).optional(),
    allowAllOrganizations: z.boolean().optional(),
    organizationIds: z.array(z.string()).optional(),
  })
  .superRefine((data, ctx) => {
    if (data.allowAllOrganizations === false) {
      if (!data.organizationIds || data.organizationIds.length === 0) {
        ctx.addIssue({
          code: "custom",
          message: "未勾选全部组织时，请至少绑定一个组织",
          path: ["organizationIds"],
        })
      }
    }
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
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message || "Invalid payload" },
      { status: 400 }
    )
  }

  const existing = await prisma.oAuthClient.findUnique({ where: { id } })
  if (!existing) {
    return NextResponse.json({ error: "应用不存在" }, { status: 404 })
  }

  const { organizationIds, ...rest } = parsed.data
  const nextAllowAll =
    rest.allowAllOrganizations ?? existing.allowAllOrganizations

  const shouldUpdateOrgs =
    organizationIds !== undefined || rest.allowAllOrganizations !== undefined

  if (shouldUpdateOrgs) {
    await prisma.oAuthClientOrganization.deleteMany({ where: { clientId: id } })
    if (!nextAllowAll && organizationIds && organizationIds.length > 0) {
      await prisma.oAuthClientOrganization.createMany({
        data: organizationIds.map((organizationId) => ({
          clientId: id,
          organizationId,
        })),
      })
    }
  }

  const app = await prisma.oAuthClient.update({
    where: { id },
    data: rest,
    select: {
      id: true,
      clientId: true,
      name: true,
      redirectUris: true,
      allowedScopes: true,
      isConfidential: true,
      allowAllOrganizations: true,
      status: true,
      createdAt: true,
      organizations: {
        select: {
          organization: { select: { id: true, name: true, slug: true } },
        },
      },
    },
  })

  return NextResponse.json({
    app: {
      ...app,
      organizations: app.organizations.map((o) => o.organization),
    },
  })
}

export async function DELETE(_request: Request, ctx: Ctx) {
  try {
    await requireAdmin()
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const { id } = await ctx.params
  await prisma.oAuthClient.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
