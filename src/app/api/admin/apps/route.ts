import { NextResponse } from "next/server"
import { z } from "zod"

import { requireAdmin } from "@/lib/auth/session"
import { hashPassword } from "@/lib/auth/password"
import { recordAudit } from "@/lib/audit/log"
import { generateToken } from "@/lib/crypto"
import { prisma } from "@/lib/db"

const createSchema = z
  .object({
    name: z.string().min(1).max(128),
    redirectUris: z.array(z.string().url()).min(1),
    allowedScopes: z.string().default("openid profile email"),
    isConfidential: z.boolean().default(true),
    allowAllOrganizations: z.boolean().default(false),
    organizationIds: z.array(z.string()).default([]),
  })
  .refine(
    (d) => d.allowAllOrganizations || d.organizationIds.length > 0,
    { message: "请选择组织或勾选全部组织" }
  )

export async function GET() {
  try {
    await requireAdmin()
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const apps = await prisma.oAuthClient.findMany({
    orderBy: { createdAt: "desc" },
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
          organizationId: true,
          organization: { select: { id: true, name: true, slug: true } },
        },
      },
    },
  })

  return NextResponse.json({
    apps: apps.map((a) => ({
      ...a,
      organizations: a.organizations.map((o) => o.organization),
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
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message || "Invalid payload" },
      { status: 400 }
    )
  }

  const clientId = `ruan_${generateToken(12)}`
  const clientSecret = parsed.data.isConfidential ? generateToken(24) : null
  const clientSecretHash = clientSecret
    ? await hashPassword(clientSecret)
    : null

  const app = await prisma.oAuthClient.create({
    data: {
      clientId,
      clientSecretHash,
      name: parsed.data.name,
      redirectUris: parsed.data.redirectUris,
      allowedScopes: parsed.data.allowedScopes,
      isConfidential: parsed.data.isConfidential,
      allowAllOrganizations: parsed.data.allowAllOrganizations,
      organizations: parsed.data.allowAllOrganizations
        ? undefined
        : {
            create: parsed.data.organizationIds.map((organizationId) => ({
              organizationId,
            })),
          },
    },
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
    },
  })

  await recordAudit({
    action: "ADMIN_APP_CREATED",
    actor: admin,
    targetType: "app",
    targetId: app.clientId,
    targetName: app.name,
    request,
    metadata: {
      isConfidential: app.isConfidential,
      allowAllOrganizations: app.allowAllOrganizations,
      scopes: app.allowedScopes,
      // The redirect URIs are where authorization codes will be delivered, so
      // they belong in the record of who registered this client.
      redirectUris: parsed.data.redirectUris,
    },
  })

  return NextResponse.json({ app, clientSecret }, { status: 201 })
}
