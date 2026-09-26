import { NextResponse } from "next/server"

import { getSessionUser } from "@/lib/auth/session"
import { prisma } from "@/lib/db"
import { getAppUrl } from "@/lib/env"
import {
  authorizeReturnTo,
  parseAuthorizeParams,
  validateAuthorizeRequest,
} from "@/lib/oidc/validate"

export async function GET(request: Request) {
  const url = new URL(request.url)
  const params = parseAuthorizeParams(url.searchParams)

  const client = await prisma.oAuthClient.findUnique({
    where: { clientId: params.client_id },
  })
  const validation = validateAuthorizeRequest(params, client)

  if (!validation.ok) {
    if (params.redirect_uri && client) {
      // Only redirect errors when redirect_uri is known-valid; otherwise show JSON
      const redirectUris = Array.isArray(client.redirectUris)
        ? client.redirectUris.map(String)
        : []
      if (redirectUris.includes(params.redirect_uri)) {
        const target = new URL(params.redirect_uri)
        target.searchParams.set("error", validation.error)
        target.searchParams.set("error_description", validation.description)
        if (params.state) target.searchParams.set("state", params.state)
        return NextResponse.redirect(target)
      }
    }
    return NextResponse.json(
      { error: validation.error, error_description: validation.description },
      { status: 400 }
    )
  }

  const user = await getSessionUser()
  if (!user) {
    const returnTo = authorizeReturnTo(params)
    const login = new URL("/login", getAppUrl())
    login.searchParams.set("returnTo", returnTo)
    return NextResponse.redirect(login)
  }

  // Always render the consent screen so the user can approve or deny. An existing
  // consent record must not auto-approve: doing so makes the deny action unreachable
  // on returning logins. The consent page pre-selects approval when consent stands.
  const consentUrl = new URL("/consent", getAppUrl())
  for (const [k, v] of url.searchParams.entries()) {
    consentUrl.searchParams.set(k, v)
  }
  return NextResponse.redirect(consentUrl)
}
