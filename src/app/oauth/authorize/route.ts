import { NextResponse } from "next/server"

import { getSessionUser } from "@/lib/auth/session"
import { prisma } from "@/lib/db"
import { getAppUrl } from "@/lib/env"
import {
  approveAndIssueCode,
  getStoredConsentScopes,
  shouldSkipConsent,
} from "@/lib/oidc/consent-flow"
import {
  authorizeReturnTo,
  buildRedirectWithError,
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

  // Client existence is checked separately from `validation.ok`: the validator
  // returns scopes rather than the row, so it cannot narrow `client` to
  // non-null, and folding the two together would also erase the discriminated
  // union that carries `validation.error`.
  if (!client) {
    return NextResponse.json(
      { error: "invalid_client", error_description: "Unknown or disabled client" },
      { status: 400 }
    )
  }

  if (!validation.ok) {
    if (params.redirect_uri) {
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

  // Consent is skipped only when a stored consent already covers every scope
  // in this request (see shouldSkipConsent). The skip is deliberately narrow:
  //
  // - A widened request (client added a scope) returns to the consent screen,
  //   so a user is never silently granted something they have not seen.
  // - Denial stays reachable. Users can withdraw a grant from /account, which
  //   deletes the consent row and brings the prompt back on the next login.
  //
  // The skip and the explicit "allow" click both funnel through
  // approveAndIssueCode, so the skip cannot return to the client without a
  // code. That failure mode — redirecting to the app with no `code`, leaving
  // the client unable to obtain a token — is what an earlier hand-rolled skip
  // implementation did, and sharing the issuing path is what rules it out.
  const storedScopes = await getStoredConsentScopes(user.id, params.client_id)
  if (shouldSkipConsent(storedScopes, validation.scopes)) {
    const result = await approveAndIssueCode({
      userId: user.id,
      clientDbId: client.id,
      allowAllOrganizations: client.allowAllOrganizations,
      // Skipping records no new grant; the standing consent already covers it.
      recordConsent: false,
      params,
      scopes: validation.scopes,
    })
    if (!result.ok) {
      // Organization access is re-checked inside approveAndIssueCode. Denying
      // here (rather than falling through to the consent screen) is deliberate:
      // the user must not be able to approve a request they are not entitled
      // to, so the screen would only offer them a dead end.
      return NextResponse.redirect(
        buildRedirectWithError(
          params.redirect_uri,
          "access_denied",
          "User is not a member of an allowed organization",
          params.state
        )
      )
    }
    return NextResponse.redirect(result.redirectTo)
  }

  // Otherwise render the consent screen so the user can approve or deny.
  const consentUrl = new URL("/consent", getAppUrl())
  for (const [k, v] of url.searchParams.entries()) {
    consentUrl.searchParams.set(k, v)
  }
  return NextResponse.redirect(consentUrl)
}
