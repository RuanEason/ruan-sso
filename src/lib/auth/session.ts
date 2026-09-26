import { cookies, headers } from "next/headers"
import type { Role, User, UserStatus } from "@prisma/client"

import { generateToken, hashToken } from "@/lib/crypto"
import { prisma } from "@/lib/db"
import { SESSION_COOKIE, SESSION_TTL_MS } from "@/lib/env"

export type SessionUser = Pick<
  User,
  "id" | "username" | "email" | "displayName" | "role" | "status"
>

export async function createSession(userId: string): Promise<string> {
  const token = generateToken(32)
  const tokenHash = hashToken(token)
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS)
  const hdrs = await headers()

  await prisma.session.create({
    data: {
      userId,
      tokenHash,
      expiresAt,
      ip: hdrs.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
      userAgent: hdrs.get("user-agent"),
    },
  })

  const cookieStore = await cookies()
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  })

  return token
}

export async function destroySession(): Promise<void> {
  const cookieStore = await cookies()
  const token = cookieStore.get(SESSION_COOKIE)?.value
  if (token) {
    await prisma.session.deleteMany({ where: { tokenHash: hashToken(token) } })
  }
  cookieStore.delete(SESSION_COOKIE)
}

export async function getSessionUser(): Promise<SessionUser | null> {
  const cookieStore = await cookies()
  const token = cookieStore.get(SESSION_COOKIE)?.value
  if (!token) return null

  const session = await prisma.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: {
      user: {
        select: {
          id: true,
          username: true,
          email: true,
          displayName: true,
          role: true,
          status: true,
        },
      },
    },
  })

  if (!session) return null
  if (session.expiresAt < new Date()) {
    await prisma.session.delete({ where: { id: session.id } })
    return null
  }
  if (session.user.status !== ("ACTIVE" satisfies UserStatus)) {
    return null
  }

  return session.user
}

export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser()
  if (!user) {
    throw new Error("UNAUTHORIZED")
  }
  return user
}

export async function requireAdmin(): Promise<SessionUser> {
  const user = await requireUser()
  if (user.role !== ("ADMIN" satisfies Role)) {
    throw new Error("FORBIDDEN")
  }
  return user
}

export async function listUserSessions(userId: string) {
  return prisma.session.findMany({
    where: { userId, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      ip: true,
      userAgent: true,
      expiresAt: true,
      createdAt: true,
    },
  })
}

export async function revokeSession(sessionId: string, userId: string) {
  await prisma.session.deleteMany({ where: { id: sessionId, userId } })
}
