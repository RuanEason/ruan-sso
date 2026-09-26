import { describe, expect, it } from "vitest"

import {
  ADMIN_HOME_PATH,
  PORTAL_PATH,
  isSafeReturnTo,
  resolvePostLoginDestination,
} from "@/lib/return-to"

/**
 * The post-login destination drives a browser navigation, so it has two jobs:
 * never leave the origin, and never send a user somewhere they will be bounced
 * out of.
 *
 * The bug these cases pin down: before the portal existed, `/login` with no
 * `returnTo` defaulted to `/admin`. A plain user was therefore sent to the admin
 * console, denied by the admin layout, and redirected back to `/login` — a loop
 * they could not escape, with no message explaining it.
 */
describe("resolvePostLoginDestination", () => {
  it("honours a safe returnTo, so the authorization flow still completes", () => {
    // This is the case that must not regress: a user arriving from an app has to
    // be sent back into /oauth/authorize or the app never gets a code.
    const authorize =
      "/oauth/authorize?client_id=ruan-demo-app&response_type=code"
    expect(
      resolvePostLoginDestination({ returnTo: authorize, role: "USER" })
    ).toBe(authorize)
    expect(
      resolvePostLoginDestination({ returnTo: "/admin/users", role: "ADMIN" })
    ).toBe("/admin/users")
  })

  it("sends a user with no returnTo to the portal, not the admin console", () => {
    // The regression: this used to be "/admin", which bounced every non-admin
    // straight back to the login page.
    expect(resolvePostLoginDestination({ returnTo: null, role: "USER" })).toBe(
      PORTAL_PATH
    )
  })

  it("sends an admin with no returnTo to the admin console", () => {
    expect(resolvePostLoginDestination({ returnTo: null, role: "ADMIN" })).toBe(
      ADMIN_HOME_PATH
    )
  })

  it("treats an unknown role as a plain user", () => {
    // A malformed or missing role must not grant the admin landing page.
    expect(resolvePostLoginDestination({ returnTo: null, role: undefined })).toBe(
      PORTAL_PATH
    )
    expect(resolvePostLoginDestination({ returnTo: null, role: null })).toBe(
      PORTAL_PATH
    )
  })

  it("does not resolve an unsafe returnTo to /admin", () => {
    // Previously an unsafe value was silently coerced to /admin, which meant an
    // attacker-supplied (or merely stale) value could still route a normal user
    // into the admin area — and from there into the redirect loop. An unsafe
    // value must be treated as "no destination given".
    for (const unsafe of ["//evil.example.com", "/\\evil.example.com", "https://evil.example.com"]) {
      expect(resolvePostLoginDestination({ returnTo: unsafe, role: "USER" })).toBe(
        PORTAL_PATH
      )
    }
  })

  it("keeps an empty returnTo from being used as a destination", () => {
    expect(resolvePostLoginDestination({ returnTo: "", role: "USER" })).toBe(
      PORTAL_PATH
    )
  })

  it("never returns an off-origin destination for any rejected input", () => {
    for (const value of [null, undefined, "", "admin", "//evil.com", "/\\evil.com"]) {
      const dest = resolvePostLoginDestination({ returnTo: value, role: "USER" })
      expect(isSafeReturnTo(dest)).toBe(true)
    }
  })
})

/**
 * `isSafeReturnTo` used to exist twice: once in lib/oidc/validate and once
 * hand-copied inside the login form, with a comment promising the two matched.
 * Both now import this single function, so these cases describe the only
 * implementation rather than pinning two copies in step.
 */
describe("isSafeReturnTo", () => {
  it("accepts ordinary in-app paths", () => {
    expect(isSafeReturnTo("/admin")).toBe(true)
    expect(isSafeReturnTo("/portal")).toBe(true)
    expect(isSafeReturnTo("/oauth/authorize?client_id=x&scope=openid")).toBe(true)
    expect(isSafeReturnTo("/")).toBe(true)
  })

  it("rejects paths that are not rooted at /", () => {
    expect(isSafeReturnTo("admin")).toBe(false)
    expect(isSafeReturnTo("https://evil.example.com")).toBe(false)
    expect(isSafeReturnTo("javascript:alert(1)")).toBe(false)
  })

  it("rejects protocol-relative URLs, which browsers resolve to another origin", () => {
    expect(isSafeReturnTo("//evil.example.com")).toBe(false)
    expect(isSafeReturnTo("//evil.example.com/path")).toBe(false)
    expect(isSafeReturnTo("/\\evil.example.com")).toBe(false)
  })

  it("rejects empty and missing values", () => {
    expect(isSafeReturnTo("")).toBe(false)
    expect(isSafeReturnTo(null)).toBe(false)
    expect(isSafeReturnTo(undefined)).toBe(false)
  })
})
