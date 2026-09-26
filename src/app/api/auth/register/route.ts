import { NextResponse } from "next/server"
import { z } from "zod"

import { createSession } from "@/lib/auth/session"
import { hashPassword } from "@/lib/auth/password"
import { prisma } from "@/lib/db"

const bodySchema = z.object({
  username: z.string().min(2).max(64),
  email: z.string().email(),
  displayName: z.string().min(1).max(128),
  password: z.string().min(6).max(128),
  organizationSlug: z.string().min(1).optional(),
})

export async function POST(request: Request) {
  const json = await request.json().catch(() => null)
  const parsed = bodySchema.safeParse(json)
  if (!parsed.success) {
    return NextResponse.json({ error: "请检查表单填写" }, { status: 400 })
  }

  const org = parsed.data.organizationSlug
    ? await prisma.organization.findUnique({
        where: { slug: parsed.data.organizationSlug },
      })
    : await prisma.organization.findFirst({
        where: {
          type: "PUBLIC",
          status: "ACTIVE",
          allowSelfRegister: true,
        },
        orderBy: { createdAt: "asc" },
      })

  if (
    !org ||
    org.status !== "ACTIVE" ||
    !org.allowSelfRegister ||
    org.type !== "PUBLIC"
  ) {
    return NextResponse.json(
      { error: "该组织不允许自助注册" },
      { status: 403 }
    )
  }

  const exists = await prisma.user.findFirst({
    where: {
      OR: [
        { username: parsed.data.username },
        { email: parsed.data.email },
      ],
    },
  })
  if (exists) {
    return NextResponse.json({ error: "用户名或邮箱已存在" }, { status: 409 })
  }

  const passwordHash = await hashPassword(parsed.data.password)
  const user = await prisma.user.create({
    data: {
      username: parsed.data.username,
      email: parsed.data.email,
      displayName: parsed.data.displayName,
      passwordHash,
      role: "USER",
      memberships: {
        create: {
          organizationId: org.id,
          role: "MEMBER",
        },
      },
    },
    select: {
      id: true,
      username: true,
      email: true,
      displayName: true,
      role: true,
      status: true,
    },
  })

  await createSession(user.id)
  return NextResponse.json({ user, organization: { slug: org.slug, name: org.name } }, { status: 201 })
}
