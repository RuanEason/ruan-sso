import { describe, expect, it } from "vitest"

import { shouldSkipConsent } from "@/lib/oidc/consent-flow"

/**
 * `shouldSkipConsent` decides whether the authorize endpoint may bypass the
 * consent screen. It is deliberately pure so the security-relevant cases below
 * can be pinned down without a database.
 */
describe("shouldSkipConsent", () => {
  it("does not skip when the user has never consented", () => {
    expect(shouldSkipConsent(null, "openid")).toBe(false)
    expect(shouldSkipConsent(undefined, "openid")).toBe(false)
    expect(shouldSkipConsent("", "openid")).toBe(false)
  })

  it("skips when the stored consent covers the request", () => {
    expect(shouldSkipConsent("openid profile email", "openid")).toBe(true)
    expect(shouldSkipConsent("openid profile email", "openid profile")).toBe(true)
    expect(shouldSkipConsent("openid", "openid")).toBe(true)
  })

  it("does not skip when the request widens the stored consent", () => {
    // A client that adds a scope must send the user back to the consent
    // screen: skipping here would hand over a permission never shown.
    expect(shouldSkipConsent("openid", "openid profile")).toBe(false)
    expect(shouldSkipConsent("openid profile", "openid profile email")).toBe(false)
  })

  it("is insensitive to scope ordering, spacing and duplication", () => {
    expect(shouldSkipConsent("email   openid profile", "openid email")).toBe(true)
    expect(shouldSkipConsent("openid openid profile", "openid profile")).toBe(true)
    expect(shouldSkipConsent(" openid  ", "openid")).toBe(true)
  })

  it("never auto-approves an empty or blank request", () => {
    // A blank scope must not be treated as "nothing requested, so vacuously
    // covered" — that would skip consent for a request whose scopes failed to
    // parse.
    expect(shouldSkipConsent("openid profile", "")).toBe(false)
    expect(shouldSkipConsent("openid profile", "   ")).toBe(false)
    expect(shouldSkipConsent("", "")).toBe(false)
  })

  it("does not skip a scope the client removed from the stored grant", () => {
    expect(shouldSkipConsent("openid", "email")).toBe(false)
    expect(shouldSkipConsent("openid profile", "openid email")).toBe(false)
  })
})
