import { NextResponse } from "next/server"
import { z } from "zod"

import { createSession, getSessionUser } from "@/lib/auth/session"
import { verifyPassword } from "@/lib/auth/password"
import {
  checkRateLimit,
  resetRateLimit,
  LOGIN_LIMIT,
  LOGIN_WINDOW_MS,
} from "@/lib/auth/rate-limit"
import { clientIp, recordAudit } from "@/lib/audit/log"
import { prisma } from "@/lib/db"

const bodySchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
})

/**
 * A valid bcrypt hash of a value no user can supply. Comparing against it when
 * the account does not exist keeps the response time of "unknown user" and
 * "wrong password" indistinguishable, so the endpoint cannot be used to
 * enumerate valid usernames.
 */
const DUMMY_HASH = "$2b$12$C6UzMDM.H6dfI/f/IKcEeO1M0h6wZ7Ykz9Q3n5oJ0lQxWfPvJ4QqK"

export async function POST(request: Request) {
  const json = await request.json().catch(() => null)
  const parsed = bodySchema.safeParse(json)
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid credentials payload" }, { status: 400 })
  }

  const existing = await getSessionUser()
  if (existing) {
    return NextResponse.json({ user: existing })
  }

  // Rate limit per account and per source address: per-account alone lets an
  // attacker spread attempts across usernames, per-IP alone lets a botnet
  // focus one account.
  const ip = clientIp(request)
  const username = parsed.data.username
  const accountLimit = checkRateLimit(`login:user:${username}`, LOGIN_LIMIT, LOGIN_WINDOW_MS)
  const ipLimit = checkRateLimit(`login:ip:${ip}`, LOGIN_LIMIT * 4, LOGIN_WINDOW_MS)

  if (!accountLimit.allowed || !ipLimit.allowed) {
    const retryAfter = Math.max(accountLimit.retryAfter, ipLimit.retryAfter)
    // A blocked attempt is the signal that a guessing campaign is underway, so
    // it is recorded even though the credentials were never checked.
    await recordAudit({
      action: "LOGIN_BLOCKED",
      actorName: username,
      request,
      ip,
      metadata: { retryAfter, reason: "rate_limited" },
    })
    return NextResponse.json(
      { error: "尝试次数过多，请稍后再试" },
      { status: 429, headers: { "Retry-After": String(retryAfter) } }
    )
  }

  const user = await prisma.user.findFirst({
    where: {
      OR: [{ username: parsed.data.username }, { email: parsed.data.username }],
    },
  })

  // Always run a bcrypt comparison, even when the user is missing, so the
  // timing of this branch does not reveal whether the account exists.
  const ok = await verifyPassword(
    parsed.data.password,
    user?.passwordHash ?? DUMMY_HASH
  )

  if (!user || user.status !== "ACTIVE" || !ok) {
    // The submitted username is recorded to make credential-stuffing visible,
    // but only as the *attempted* name: it is attacker-controlled text and is
    // never treated as an identity (actorId stays null).
    await recordAudit({
      action: "LOGIN_FAILURE",
      actorName: username,
      request,
      ip,
      metadata: {
        // Distinguishes the three causes without revealing them to the caller.
        reason: !user ? "unknown_user" : user.status !== "ACTIVE" ? "disabled" : "bad_password",
      },
    })
    return NextResponse.json({ error: "用户名或密码错误" }, { status: 401 })
  }

  resetRateLimit(`login:user:${username}`)
  await createSession(user.id)

  await recordAudit({
    action: "LOGIN_SUCCESS",
    actor: { id: user.id, username: user.username, role: user.role },
    targetType: "user",
    targetId: user.id,
    targetName: user.username,
    request,
    ip,
  })

  return NextResponse.json({
    user: {
      id: user.id,
      username: user.username,
      email: user.email,
      displayName: user.displayName,
      role: user.role,
      status: user.status,
    },
  })
}
