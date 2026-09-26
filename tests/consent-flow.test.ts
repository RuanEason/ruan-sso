import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * Guards for the two invariants that the consent-skipping feature must never
 * break. Both are about `approveAndIssueCode`, the single function through
 * which every approval has to pass.
 *
 * Prisma, the org-access check and the code issuer are mocked so the tests stay
 * pure and exercise only the flow's own decisions.
 */
const consentUpsert = vi.fn()
const canAccess = vi.fn()
const issueAuthorizationCode = vi.fn()

vi.mock("@/lib/db", () => ({
  prisma: {
    consent: {
      upsert: (...args: unknown[]) => consentUpsert(...args),
    },
  },
}))

vi.mock("@/lib/org/access", () => ({
  userCanAccessClient: (...args: unknown[]) => canAccess(...args),
}))

vi.mock("@/lib/oidc/token", () => ({
  issueAuthorizationCode: (...args: unknown[]) => issueAuthorizationCode(...args),
}))

const { approveAndIssueCode } = await import("@/lib/oidc/consent-flow")

const PARAMS = {
  client_id: "ruan-demo-app",
  redirect_uri: "http://localhost:4000/callback",
  response_type: "code",
  state: "xyz",
  code_challenge: "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
  code_challenge_method: "S256",
}

function approve(overrides: Record<string, unknown> = {}) {
  return approveAndIssueCode({
    userId: "user-1",
    clientDbId: "client-db-id",
    allowAllOrganizations: true,
    recordConsent: false,
    params: PARAMS,
    scopes: "openid profile",
    ...overrides,
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  canAccess.mockResolvedValue(true)
  issueAuthorizationCode.mockResolvedValue("AUTH_CODE")
  consentUpsert.mockResolvedValue({})
})

describe("approveAndIssueCode", () => {
  it("issues a code and returns a callback carrying it", async () => {
    // The bug this feature shipped with once: the browser was sent back to the
    // client with no `code`, so the app could never exchange it for a token.
    const result = await approve()
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error("expected approval")
    expect(issueAuthorizationCode).toHaveBeenCalledTimes(1)

    const url = new URL(result.redirectTo)
    expect(url.searchParams.get("code")).toBe("AUTH_CODE")
    expect(url.searchParams.get("state")).toBe("xyz")
  })

  it("issues a code on BOTH the skip and the explicit-allow path", async () => {
    // Whatever differs between them, code issuance must not. `recordConsent` is
    // the only intended difference: a skip has no new user grant to persist.
    const skipped = await approve({ recordConsent: false })
    const explicit = await approve({ recordConsent: true })

    expect(skipped.ok && explicit.ok).toBe(true)
    expect(issueAuthorizationCode).toHaveBeenCalledTimes(2)
    expect(consentUpsert).toHaveBeenCalledTimes(1)
  })

  it("passes PKCE and nonce through unchanged", async () => {
    await approve({ params: { ...PARAMS, nonce: "n-1" } })
    expect(issueAuthorizationCode).toHaveBeenCalledWith(
      expect.objectContaining({
        clientId: "ruan-demo-app",
        userId: "user-1",
        redirectUri: "http://localhost:4000/callback",
        scopes: "openid profile",
        codeChallenge: PARAMS.code_challenge,
        codeChallengeMethod: "S256",
        nonce: "n-1",
      })
    )
  })

  it("defaults code_challenge_method to S256 when omitted", async () => {
    await approve({
      params: { ...PARAMS, code_challenge_method: undefined },
    })
    expect(issueAuthorizationCode).toHaveBeenCalledWith(
      expect.objectContaining({ codeChallengeMethod: "S256" })
    )
  })

  it("writes nothing and issues nothing when the user lacks org access", async () => {
    // Ordering matters: persisting a consent row before the access check would
    // leave a grant recorded for a request that is then denied — and, because a
    // stored consent now drives skipping, that phantom row would later cause a
    // skipped prompt for a user who was never actually allowed in.
    canAccess.mockResolvedValue(false)
    const result = await approve({ recordConsent: true })

    expect(result).toEqual({ ok: false, failure: { reason: "no_org_access" } })
    expect(consentUpsert).not.toHaveBeenCalled()
    expect(issueAuthorizationCode).not.toHaveBeenCalled()
  })
})
