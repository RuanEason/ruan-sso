import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

import { describe, expect, it } from "vitest"

/**
 * "Denial must stay reachable" is the invariant that a previous consent-skip
 * implementation violated, and violating it is not a cosmetic regression: it
 * silently removes the user's ability to refuse.
 *
 * It cannot be expressed by `shouldSkipConsent` alone, because reachability is
 * a property of how the routes fit together — which branch the authorize
 * endpoint takes and whether a withdrawal path still exists. These are
 * structural assertions over the sources. They are intentionally blunt: they
 * fail if a future change deletes the deny branch, auto-approves on *every*
 * request, or drops the revocation endpoint.
 */
function source(relative: string): string {
  return readFileSync(
    fileURLToPath(new URL(`../src/${relative}`, import.meta.url)),
    "utf8"
  )
}

describe("denial stays reachable", () => {
  it("keeps a branch that renders the consent screen instead of always skipping", () => {
    // If this disappears, the consent screen becomes unreachable and every
    // returning user is auto-approved — the original regression.
    const route = source("app/oauth/authorize/route.ts")
    expect(route).toMatch(/shouldSkipConsent\(/)
    expect(route).toMatch(new RegExp('/consent'))
    expect(route).toMatch(/NextResponse\.redirect\(consentUrl\)/)
  })

  it("does not skip unconditionally", () => {
    // A skip nested under a condition, not executed on every request.
    const route = source("app/oauth/authorize/route.ts")
    expect(route).toMatch(/if \(shouldSkipConsent\([^)]*\)\) \{/)
  })

  it("keeps the deny decision in the consent action", () => {
    const actions = source("app/consent/actions.ts")
    expect(actions).toMatch(/decision === "deny"/)
    expect(actions).toMatch(/buildRedirectWithError\(/)
    expect(actions).toMatch(/access_denied/)
  })

  it("keeps a consent screen offering both allow and deny", () => {
    const page = source("app/consent/page.tsx")
    expect(page).toMatch(/name="decision" value="deny"/)
    expect(page).toMatch(/name="decision" value="allow"/)
  })

  it("offers a withdrawal path, without which skipping locks users in", () => {
    // Once consent can be skipped, a user who ever clicked "allow" is
    // auto-approved forever. Revoking must remain possible.
    const api = source("app/api/account/consents/route.ts")
    expect(api).toMatch(/export async function DELETE/)
    expect(api).toMatch(/prisma\.consent\.deleteMany/)
    // Scoped to the caller, so one user cannot revoke another's grant.
    expect(api).toMatch(/where: \{ userId: user\.id, clientId \}/)
  })

  it("routes every approval through the shared code-issuing function", () => {
    // Neither the skip branch nor the consent action may build a callback URL
    // by hand or bypass code issuance.
    const route = source("app/oauth/authorize/route.ts")
    const actions = source("app/consent/actions.ts")

    expect(route).toMatch(/approveAndIssueCode\(/)
    expect(actions).toMatch(/approveAndIssueCode\(/)

    // The route must not import the raw issuer: going through the shared flow
    // is what guarantees a skip still returns a `code`.
    expect(route).not.toMatch(/from "@\/lib\/oidc\/token"/)
    expect(route).not.toMatch(/buildRedirectWithCode/)
  })
})
