import { describe, expect, it } from "vitest"

import {
  buildRedirectWithCode,
  buildRedirectWithError,
  parseAuthorizeParams,
  parseRedirectUris,
  scopesCovered,
  validateAuthorizeRequest,
  type AuthorizeParams,
} from "@/lib/oidc/validate"

/**
 * A stand-in for the Prisma OAuthClient row. `validateAuthorizeRequest` only
 * reads these fields, so the test needs no database.
 */
function makeClient(overrides: Record<string, unknown> = {}) {
  return {
    id: "client-db-id",
    clientId: "ruan-demo-app",
    name: "Demo",
    status: "ACTIVE",
    redirectUris: ["http://localhost:4000/callback"],
    allowedScopes: "openid profile email",
    isConfidential: true,
    allowAllOrganizations: true,
    clientSecretHash: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as Parameters<typeof validateAuthorizeRequest>[1]
}

function makeParams(overrides: Partial<AuthorizeParams> = {}): AuthorizeParams {
  return {
    client_id: "ruan-demo-app",
    redirect_uri: "http://localhost:4000/callback",
    response_type: "code",
    scope: "openid profile email",
    state: "xyz",
    code_challenge: "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
    code_challenge_method: "S256",
    ...overrides,
  }
}

describe("parseAuthorizeParams", () => {
  it("reads all supported parameters", () => {
    const qs = new URLSearchParams(
      "client_id=a&redirect_uri=http%3A%2F%2Fx%2Fcb&response_type=code&scope=openid&state=s&code_challenge=c&code_challenge_method=S256&nonce=n"
    )
    const p = parseAuthorizeParams(qs)
    expect(p.client_id).toBe("a")
    expect(p.redirect_uri).toBe("http://x/cb")
    expect(p.nonce).toBe("n")
  })

  it("returns empty strings rather than undefined for required fields", () => {
    const p = parseAuthorizeParams(new URLSearchParams())
    expect(p.client_id).toBe("")
    expect(p.redirect_uri).toBe("")
    expect(p.response_type).toBe("")
    expect(p.scope).toBeUndefined()
  })
})

describe("validateAuthorizeRequest", () => {
  it("accepts a well-formed request and normalises scope order", () => {
    const result = validateAuthorizeRequest(makeParams(), makeClient())
    expect(result).toEqual({ ok: true, scopes: "openid profile email" })
  })

  it("rejects a missing client_id", () => {
    const result = validateAuthorizeRequest(makeParams({ client_id: "" }), makeClient())
    expect(result).toMatchObject({ ok: false, error: "invalid_request" })
  })

  it("rejects an unknown or disabled client", () => {
    expect(validateAuthorizeRequest(makeParams(), null)).toMatchObject({
      ok: false,
      error: "invalid_client",
    })
    expect(
      validateAuthorizeRequest(makeParams(), makeClient({ status: "DISABLED" }))
    ).toMatchObject({ ok: false, error: "invalid_client" })
  })

  it("rejects response types other than code", () => {
    for (const rt of ["token", "id_token", "code token", ""]) {
      expect(
        validateAuthorizeRequest(makeParams({ response_type: rt }), makeClient())
      ).toMatchObject({ ok: false, error: "unsupported_response_type" })
    }
  })

  it("rejects an unregistered redirect_uri, including near-matches", () => {
    const bad = [
      "http://localhost:4000/callback/",
      "http://localhost:4000/callback?x=1",
      "http://localhost:4001/callback",
      "http://evil.example.com/callback",
      "http://localhost:4000/Callback",
    ]
    for (const uri of bad) {
      expect(
        validateAuthorizeRequest(makeParams({ redirect_uri: uri }), makeClient())
      ).toMatchObject({ ok: false, error: "invalid_request" })
    }
  })

  it("requires PKCE", () => {
    expect(
      validateAuthorizeRequest(makeParams({ code_challenge: undefined }), makeClient())
    ).toMatchObject({ ok: false, error: "invalid_request" })
    expect(
      validateAuthorizeRequest(makeParams({ code_challenge: "" }), makeClient())
    ).toMatchObject({ ok: false, error: "invalid_request" })
  })

  it("accepts an omitted code_challenge_method as S256 but rejects anything else", () => {
    expect(
      validateAuthorizeRequest(
        makeParams({ code_challenge_method: undefined }),
        makeClient()
      ).ok
    ).toBe(true)
    for (const m of ["plain", "S512", "s256", ""]) {
      expect(
        validateAuthorizeRequest(
          makeParams({ code_challenge_method: m }),
          makeClient()
        )
      ).toMatchObject({ ok: false, error: "invalid_request" })
    }
  })

  it("requires the openid scope", () => {
    expect(
      validateAuthorizeRequest(makeParams({ scope: "profile email" }), makeClient())
    ).toMatchObject({ ok: false, error: "invalid_scope" })
  })

  it("rejects scopes outside allowedScopes", () => {
    expect(
      validateAuthorizeRequest(makeParams({ scope: "openid admin" }), makeClient())
    ).toMatchObject({ ok: false, error: "invalid_scope" })
  })

  it("treats a blank allowedScopes as the default set", () => {
    expect(
      validateAuthorizeRequest(
        makeParams({ scope: "openid profile" }),
        makeClient({ allowedScopes: "" })
      ).ok
    ).toBe(true)
  })

  it("defaults the scope when none is requested", () => {
    const result = validateAuthorizeRequest(
      makeParams({ scope: undefined }),
      makeClient()
    )
    expect(result).toEqual({ ok: true, scopes: "openid profile email" })
  })
})

describe("parseRedirectUris", () => {
  it("handles arrays, JSON strings and whitespace-separated strings", () => {
    expect(parseRedirectUris(["a", "b"])).toEqual(["a", "b"])
    expect(parseRedirectUris('["a","b"]')).toEqual(["a", "b"])
    expect(parseRedirectUris("a b")).toEqual(["a", "b"])
  })

  it("returns an empty list for unusable input", () => {
    expect(parseRedirectUris(null)).toEqual([])
    expect(parseRedirectUris(42)).toEqual([])
    expect(parseRedirectUris({})).toEqual([])
  })
})

describe("scopesCovered", () => {
  it("is true when granted covers requested", () => {
    expect(scopesCovered("openid profile email", "openid profile")).toBe(true)
    expect(scopesCovered("openid profile email", "openid")).toBe(true)
  })

  it("is false when a requested scope is missing", () => {
    expect(scopesCovered("openid", "openid profile")).toBe(false)
    expect(scopesCovered("", "openid")).toBe(false)
  })
})

describe("redirect builders", () => {
  it("appends code and preserves existing query parameters", () => {
    const url = buildRedirectWithCode("http://localhost:4000/callback?keep=1", "CODE", "st")
    const parsed = new URL(url)
    expect(parsed.searchParams.get("code")).toBe("CODE")
    expect(parsed.searchParams.get("state")).toBe("st")
    expect(parsed.searchParams.get("keep")).toBe("1")
  })

  it("omits state when absent", () => {
    const url = new URL(buildRedirectWithCode("http://localhost:4000/callback", "CODE"))
    expect(url.searchParams.has("state")).toBe(false)
  })

  it("builds an error redirect with a description", () => {
    const url = new URL(
      buildRedirectWithError("http://localhost:4000/callback", "access_denied", "nope", "st")
    )
    expect(url.searchParams.get("error")).toBe("access_denied")
    expect(url.searchParams.get("error_description")).toBe("nope")
    expect(url.searchParams.get("state")).toBe("st")
  })
})
