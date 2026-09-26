"use server"

import { redirect } from "next/navigation"

import { getSessionUser } from "@/lib/auth/session"
import { prisma } from "@/lib/db"
import { userCanAccessClient } from "@/lib/org/access"
import {
  buildRedirectWithCode,
  buildRedirectWithError,
  parseAuthorizeParams,
  validateAuthorizeRequest,
} from "@/lib/oidc/validate"
import { issueAuthorizationCode } from "@/lib/oidc/token"

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

  // Check organization access BEFORE recording consent. Persisting first would
  // leave a consent record for a request that is then denied, which both
  // misrepresents what the user approved and changes how later prompts render.
  const allowed = await userCanAccessClient(
    user.id,
    client.id,
    client.allowAllOrganizations
  )
  if (!allowed) {
    redirect(
      buildRedirectWithError(
        params.redirect_uri,
        "access_denied",
        "User is not a member of an allowed organization",
        params.state
      )
    )
  }

  await prisma.consent.upsert({
    where: {
      userId_clientId: { userId: user.id, clientId: params.client_id },
    },
    create: {
      userId: user.id,
      clientId: params.client_id,
      scopes: validation.scopes,
    },
    update: { scopes: validation.scopes },
  })

  const code = await issueAuthorizationCode({
    clientId: params.client_id,
    userId: user.id,
    redirectUri: params.redirect_uri,
    scopes: validation.scopes,
    codeChallenge: params.code_challenge!,
    codeChallengeMethod: params.code_challenge_method ?? "S256",
    nonce: params.nonce,
  })

  redirect(buildRedirectWithCode(params.redirect_uri, code, params.state))
}
