"use server"

import { redirect } from "next/navigation"
import { headers } from "next/headers"

import { getSessionUser } from "@/lib/auth/session"
import { prisma } from "@/lib/db"
import { recordAudit } from "@/lib/audit/log"
import { approveAndIssueCode } from "@/lib/oidc/consent-flow"
import {
  buildRedirectWithError,
  parseAuthorizeParams,
  validateAuthorizeRequest,
} from "@/lib/oidc/validate"

/**
 * A Server Action is handed FormData rather than a Request, so the request
 * metadata an audit entry needs is reconstructed from the incoming headers.
 */
async function requestHeaders(): Promise<Request> {
  const h = await headers()
  return new Request("http://internal/consent", { headers: h })
}

export async function consentAction(formData: FormData) {
  const decision = String(formData.get("decision") ?? "")
  const raw = String(formData.get("authorize_query") ?? "")
  const params = parseAuthorizeParams(new URLSearchParams(raw))

  const client = await prisma.oAuthClient.findUnique({
    where: { clientId: params.client_id },
  })
  const validation = validateAuthorizeRequest(params, client)

  if (!validation.ok || !client) {
    throw new Error(validation.ok ? "invalid_client" : validation.description)
  }

  const user = await getSessionUser()

  if (decision === "deny") {
    await recordAudit({
      action: "CONSENT_DENIED",
      actor: user ?? null,
      targetType: "app",
      targetId: params.client_id,
      targetName: client.name,
      request: await requestHeaders(),
      metadata: { reason: "user_refused", scopes: validation.scopes },
    })
    redirect(
      buildRedirectWithError(
        params.redirect_uri,
        "access_denied",
        "User denied the request",
        params.state
      )
    )
  }

  if (!user) {
    redirect(`/login?returnTo=${encodeURIComponent(`/oauth/authorize?${raw}`)}`)
  }

  const result = await approveAndIssueCode({
    userId: user.id,
    clientDbId: client.id,
    allowAllOrganizations: client.allowAllOrganizations,
    // An explicit "allow" click is a new user grant, so it is recorded.
    recordConsent: true,
    params,
    scopes: validation.scopes,
    actor: user,
    request: await requestHeaders(),
    via: "consent_screen",
  })

  if (!result.ok) {
    if (result.failure.reason === "no_org_access") {
      redirect(
        buildRedirectWithError(
          params.redirect_uri,
          "access_denied",
          "User is not a member of an allowed organization",
          params.state
        )
      )
    }
    throw new Error("invalid_client")
  }

  redirect(result.redirectTo)
}
