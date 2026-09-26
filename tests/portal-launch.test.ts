import { describe, expect, it } from "vitest"

import { primaryRedirectUri, resolveLaunchTarget } from "@/lib/portal"

/**
 * `resolveLaunchTarget` decides where the portal sends the browser to start a
 * sign-in. It is derived from the client's registered redirect URI, so a `next`
 * value must never be able to move the browser to another origin — otherwise
 * `/portal/launch/<client>` becomes an open redirect.
 *
 * The target is the client's *origin*, not the registered redirect URI itself:
 * a redirect URI is the endpoint that receives an authorization response, so
 * navigating to it cold is meaningless.
 */
const REGISTERED = "http://localhost:4000/callback"

describe("resolveLaunchTarget", () => {
  it("sends the browser to the client's origin, not its callback path", () => {
    // Landing on /callback with no code is a dead end (it 404s in the demo app).
    expect(resolveLaunchTarget(REGISTERED, null)).toBe("http://localhost:4000/")
  })

  it("adopts a same-origin path from next", () => {
    // Supports an app whose sign-in entry point is not its origin root.
    expect(resolveLaunchTarget(REGISTERED, "/login")).toBe(
      "http://localhost:4000/login"
    )
    expect(resolveLaunchTarget(REGISTERED, "/login?deny=1")).toBe(
      "http://localhost:4000/login?deny=1"
    )
  })

  it("rejects a protocol-relative next, which is a different origin", () => {
    expect(resolveLaunchTarget(REGISTERED, "//evil.example.com")).toBe(
      "http://localhost:4000/"
    )
    expect(resolveLaunchTarget(REGISTERED, "//evil.example.com/x")).toBe(
      "http://localhost:4000/"
    )
  })

  it("rejects an absolute next on another origin", () => {
    expect(resolveLaunchTarget(REGISTERED, "http://evil.example.com/a")).toBe(
      "http://localhost:4000/"
    )
    expect(resolveLaunchTarget(REGISTERED, "https://evil.example.com/a")).toBe(
      "http://localhost:4000/"
    )
  })

  it("rejects a different scheme or port on the same host", () => {
    // A different scheme or port is a different origin, so it must not be
    // adopted just because the host matches.
    expect(resolveLaunchTarget(REGISTERED, "https://localhost:4000/a")).toBe(
      "http://localhost:4000/"
    )
    expect(resolveLaunchTarget(REGISTERED, "http://localhost:9999/a")).toBe(
      "http://localhost:4000/"
    )
  })

  it("rejects a non-http scheme", () => {
    expect(resolveLaunchTarget(REGISTERED, "javascript:alert(1)")).toBe(
      "http://localhost:4000/"
    )
  })

  it("normalises traversal so the result stays on the same origin", () => {
    const result = resolveLaunchTarget(REGISTERED, "/a/../../b")
    expect(result).not.toBeNull()
    expect(new URL(result!).origin).toBe("http://localhost:4000")
  })

  it("returns null when the registered URI is missing or unusable", () => {
    expect(resolveLaunchTarget(null, "/login")).toBeNull()
    expect(resolveLaunchTarget("not a url", "/login")).toBeNull()
    expect(resolveLaunchTarget("", "/login")).toBeNull()
  })

  it("keeps the port, so a localhost client is not sent to another service", () => {
    // The origin carries the port; dropping it would send :4000 clients to :80.
    expect(resolveLaunchTarget("http://localhost:4000/cb", null)).toBe(
      "http://localhost:4000/"
    )
    expect(resolveLaunchTarget("https://app.example.com/oidc/cb", null)).toBe(
      "https://app.example.com/"
    )
  })
})

describe("primaryRedirectUri", () => {
  it("uses the first registered URI", () => {
    expect(primaryRedirectUri(["http://a/cb", "http://b/cb"])).toBe("http://a/cb")
  })

  it("skips empty entries", () => {
    expect(primaryRedirectUri(["", "http://a/cb"])).toBe("http://a/cb")
  })

  it("returns null when there is nothing usable", () => {
    expect(primaryRedirectUri([])).toBeNull()
    expect(primaryRedirectUri(null)).toBeNull()
    expect(primaryRedirectUri("http://a/cb")).toBeNull()
  })
})
