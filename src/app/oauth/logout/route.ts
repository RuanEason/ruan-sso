import { NextResponse } from "next/server"

import { destroySession, getSessionUser } from "@/lib/auth/session"
import { recordAudit } from "@/lib/audit/log"
import { prisma } from "@/lib/db"
import { getAppUrl } from "@/lib/env"
import { parseRedirectUris } from "@/lib/oidc/validate"

/**
 * Resolves `post_logout_redirect_uri` against the client's registered redirect
 * URIs.
 *
 * Without this check the endpoint is an open redirect: anyone could craft a link
 * to the trusted SSO host that forwards the user to an attacker-controlled page,
 * which is a credible phishing primitive. An unregistered value is dropped and
 * the user is sent to the local login page instead — the user-supplied string is
 * never reflected.
 *
 * The client is identified by `client_id`; RFC-compliant clients send it. When
 * it is absent we cannot validate the target, so we refuse to redirect.
 */
async function resolvePostLogoutRedirect(
  clientId: string | null,
  candidate: string | null
): Promise<string | null> {
  if (!candidate || !clientId) return null

  const client = await prisma.oAuthClient.findUnique({ where: { clientId } })
  if (!client || client.status !== "ACTIVE") return null

  const registered = parseRedirectUris(client.redirectUris)
  if (!registered.includes(candidate)) return null

  return candidate
}

function logoutResponse(target: string | null) {
  return NextResponse.redirect(
    target ? new URL(target) : new URL("/login", getAppUrl())
  )
}

/** Records the logout before the session is destroyed. */
async function auditLogout(
  request: Request,
  clientId: string | null
): Promise<void> {
  const user = await getSessionUser()
  if (!user) return
  await recordAudit({
    action: "LOGOUT",
    actor: user,
    targetType: clientId ? "app" : "user",
    targetId: clientId ?? user.id,
    targetName: clientId ?? user.username,
    request,
    metadata: { via: "oidc_end_session", clientId },
  })
}

export async function GET(request: Request) {
  const url = new URL(request.url)
  const clientId = url.searchParams.get("client_id")
  const target = await resolvePostLogoutRedirect(
    clientId,
    url.searchParams.get("post_logout_redirect_uri")
  )
  await auditLogout(request, clientId)
  await destroySession()
  return logoutResponse(target)
}

export async function POST(request: Request) {
  const contentType = request.headers.get("content-type") ?? ""
  let candidate: string | null = null
  let clientId: string | null = null

  if (contentType.includes("application/json")) {
    const json = (await request.json().catch(() => ({}))) as {
      post_logout_redirect_uri?: string
      client_id?: string
    }
    candidate = json.post_logout_redirect_uri ?? null
    clientId = json.client_id ?? null
  } else if (contentType.includes("form")) {
    const form = await request.formData()
    candidate = form.get("post_logout_redirect_uri")?.toString() ?? null
    clientId = form.get("client_id")?.toString() ?? null
  }

  const target = await resolvePostLogoutRedirect(clientId, candidate)
  await auditLogout(request, clientId)
  await destroySession()
  return logoutResponse(target)
}
