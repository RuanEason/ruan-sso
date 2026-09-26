import { NextResponse } from "next/server"

import { getSessionUser } from "@/lib/auth/session"
import { prisma } from "@/lib/db"
import { userCanAccessClient } from "@/lib/org/access"
import { primaryRedirectUri, resolveLaunchTarget } from "@/lib/portal"

/**
 * Starts a sign-in for one application from the portal.
 *
 * This endpoint does **not** build an authorization request, and deliberately so.
 *
 * PKCE requires the `code_verifier` to stay with the party that will redeem the
 * code. If the portal minted a verifier and then sent the browser to the app's
 * `redirect_uri`, the app would receive a `code` and a `state` it never issued,
 * have no verifier, and fail to exchange it — the callback would be rejected
 * outright. (Verified against the demo relying party, which correctly reported
 * `FAIL — state_roundtrip` when an earlier revision of this route did exactly
 * that.) The verifier cannot be handed over, because handing it to the browser
 * and thence to the app's own callback URL is not something the protocol
 * provides for.
 *
 * So the portal hands off: it sends the browser to the application, and the
 * application begins its own authorization request through `/oauth/authorize`
 * exactly as it does when a user arrives at it directly. Nothing about the
 * flow is special-cased for the portal, which is the point — there is still
 * exactly one path that issues codes (`approveAndIssueCode`), reached through
 * the one authorize endpoint.
 *
 * `?next=` supports an app that exposes a distinct login entry point (e.g.
 * `/login` rather than `/`). It is adopted only when it resolves to the same
 * origin as the client's registered redirect URI, so this route cannot be used
 * as an open redirect.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ clientId: string }> }
) {
  const user = await getSessionUser()
  if (!user) {
    const { clientId } = await context.params
    return NextResponse.redirect(
      new URL(`/login?returnTo=/portal/launch/${encodeURIComponent(clientId)}`, request.url)
    )
  }

  const { clientId } = await context.params
  const client = await prisma.oAuthClient.findUnique({
    where: { clientId },
    select: {
      id: true,
      clientId: true,
      status: true,
      redirectUris: true,
      allowAllOrganizations: true,
    },
  })

  if (!client || client.status !== "ACTIVE") {
    return NextResponse.redirect(new URL("/portal?error=unknown_app", request.url))
  }

  // The same access rule the authorize endpoint enforces, so a user can only
  // launch what they could actually complete.
  const allowed = await userCanAccessClient(
    user.id,
    client.id,
    client.allowAllOrganizations
  )
  if (!allowed) {
    return NextResponse.redirect(new URL("/portal?error=no_access", request.url))
  }

  const registered = primaryRedirectUri(client.redirectUris)
  const target = resolveLaunchTarget(
    registered,
    new URL(request.url).searchParams.get("next")
  )
  if (!target) {
    return NextResponse.redirect(new URL("/portal?error=no_redirect_uri", request.url))
  }

  return NextResponse.redirect(target)
}
