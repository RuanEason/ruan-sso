"use server"

import { redirect } from "next/navigation"

import { getSessionUser } from "@/lib/auth/session"
import { prisma } from "@/lib/db"
import { approveAndIssueCode } from "@/lib/oidc/consent-flow"
import {
  buildRedirectWithError,
  parseAuthorizeParams,
  validateAuthorizeRequest,
} from "@/lib/oidc/validate"

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

  if (decision === "deny") {
    redirect(
      buildRedirectWithError(
        params.redirect_uri,
        "access_denied",
        "User denied the request",
        params.state
      )
    )
  }

  const user = await getSessionUser()
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
