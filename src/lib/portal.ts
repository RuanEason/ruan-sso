import type { ClientStatus } from "@prisma/client"

/**
 * Pure "which applications may this user see in the portal" logic.
 *
 * Kept free of Prisma so it can be unit tested directly, and — more importantly
 * — kept deliberately in step with `userCanAccessClient` in `lib/org/access.ts`,
 * which is what the authorize endpoint and the consent screen enforce at
 * request time. The portal must never show a card that the enforcement layer
 * would then refuse: "visible in the portal, denied on click" is exactly the
 * contradiction this module exists to prevent.
 *
 * The two rules mirrored from `userCanAccessClient`:
 *
 * - `allowAllOrganizations` → every user may access it.
 * - otherwise the client must be bound to at least one ACTIVE organization the
 *   user is a member of. A client with no bindings and no allow-all is denied to
 *   everyone (access must be configured explicitly).
 */

/** The subset of an OAuth client the portal needs to render a card. */
export type PortalClient = {
  id: string
  clientId: string
  name: string
  allowedScopes: string
  /** Default scopes the portal requests when the client configures none. */
  allowAllOrganizations: boolean
  status: ClientStatus
  organizationIds: string[]
}

/** A client the user may access, with the scopes the portal will request. */
export type PortalApp = {
  id: string
  clientId: string
  name: string
  scopes: string
}

/**
 * The redirect URI the portal sends the browser to when launching a client.
 *
 * The first registered URI wins; `null` means the record is unusable, and the
 * card is rendered without a launch action rather than starting a sign-in that
 * cannot complete.
 */
export function primaryRedirectUri(redirectUris: unknown): string | null {
  const list = Array.isArray(redirectUris)
    ? redirectUris.map(String).filter((u) => u.length > 0)
    : []
  return list[0] ?? null
}

/**
 * Where a launch sends the browser: the application's own origin.
 *
 * The portal hands off to the application and lets it start its own
 * authorization request, because PKCE requires the `code_verifier` to stay with
 * the party that redeems the code. The portal cannot pass a verifier to a
 * third-party app's callback, so a portal-forged request could never be
 * completed — an earlier revision that minted its own verifier and jumped
 * straight to the app's `redirect_uri` was rejected by the relying party with a
 * state mismatch, and also landed the user on the callback endpoint with no
 * `code` at all.
 *
 * The target is the *origin*, not the registered redirect URI: the redirect URI
 * is the endpoint that receives an authorization response, so navigating to it
 * cold is meaningless (it 404s in the demo app). The origin is where the
 * application's own entry point lives, which is what a user needs to reach.
 *
 * `next` lets a client whose sign-in lives at a path (e.g. `/login`) say so. It
 * is adopted only when same-origin, so it cannot move the browser to another
 * host, scheme or port.
 */
export function resolveLaunchTarget(
  registered: string | null,
  next: string | null | undefined
): string | null {
  if (!registered) return null

  let base: URL
  try {
    base = new URL(registered)
  } catch {
    return null
  }

  const target = new URL(base.origin)
  if (!next) return target.toString()

  let candidate: URL
  try {
    candidate = new URL(next, base.origin)
  } catch {
    return target.toString()
  }
  if (candidate.origin !== base.origin) return target.toString()

  target.pathname = candidate.pathname
  target.search = candidate.search
  return target.toString()
}

/**
 * The scope string to request for a client.
 *
 * Mirrors `validateAuthorizeRequest`: an empty `allowedScopes` falls back to the
 * default scope set there, so an empty value must not be sent as
 * `scope=` (which the validator would reject via the "scope must include
 * openid" check). `openid` is mandatory in this protocol.
 */
export function portalScopesFor(
  allowedScopes: string,
  defaultScopes: readonly string[]
): string {
  const parsed = allowedScopes.split(/\s+/).filter(Boolean)
  const scopes = parsed.length ? parsed : [...defaultScopes]
  // The portal always requests an id token; a client configured without
  // `openid` cannot be used for sign-in at all.
  return scopes.includes("openid") ? scopes.join(" ") : ["openid", ...scopes].join(" ")
}

/**
 * Filters the client list down to what one user may access.
 *
 * `userOrgIds` is the set of organization ids the user is a member of, where the
 * organization is ACTIVE — already resolved by the caller from the database.
 */
export function visibleAppsForUser(
  clients: readonly PortalClient[],
  userOrgIds: ReadonlySet<string>,
  defaultScopes: readonly string[]
): PortalApp[] {
  return clients
    .filter((c) => c.status === "ACTIVE")
    .filter((c) => {
      if (c.allowAllOrganizations) return true
      // No binding and no allow-all → denied, matching userCanAccessClient.
      if (c.organizationIds.length === 0) return false
      return c.organizationIds.some((id) => userOrgIds.has(id))
    })
    .map((c) => ({
      id: c.id,
      clientId: c.clientId,
      name: c.name,
      scopes: portalScopesFor(c.allowedScopes, defaultScopes),
    }))
    .sort((a, b) => a.name.localeCompare(b.name, "zh-Hans-CN"))
}
