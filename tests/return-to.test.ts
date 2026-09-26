import { describe, expect, it } from "vitest"

import { isSafeReturnTo } from "@/lib/oidc/validate"

/**
 * `returnTo` drives a post-login browser navigation, so a value that escapes
 * the origin turns the login page into an open redirect. These cases pin the
 * boundary between "same-origin path" and "somewhere else".
 */
describe("isSafeReturnTo", () => {
  it("accepts ordinary in-app paths", () => {
    expect(isSafeReturnTo("/admin")).toBe(true)
    expect(isSafeReturnTo("/admin/users")).toBe(true)
    expect(isSafeReturnTo("/oauth/authorize?client_id=x&scope=openid")).toBe(true)
  })

  it("rejects a path that is not rooted at /", () => {
    expect(isSafeReturnTo("admin")).toBe(false)
    expect(isSafeReturnTo("https://evil.example.com")).toBe(false)
    expect(isSafeReturnTo("javascript:alert(1)")).toBe(false)
  })

  it("rejects protocol-relative URLs, which browsers resolve to another origin", () => {
    // The reason a naive startsWith("/") check is insufficient.
    expect(isSafeReturnTo("//evil.example.com")).toBe(false)
    expect(isSafeReturnTo("//evil.example.com/path")).toBe(false)
    // Backslash is treated as a path separator by some browsers, so "/\host"
    // can be parsed as protocol-relative too.
    expect(isSafeReturnTo("/\\evil.example.com")).toBe(false)
  })

  it("rejects empty and missing values", () => {
    expect(isSafeReturnTo("")).toBe(false)
    expect(isSafeReturnTo(null)).toBe(false)
    expect(isSafeReturnTo(undefined)).toBe(false)
  })

  it("allows a lone slash", () => {
    expect(isSafeReturnTo("/")).toBe(true)
  })
})
