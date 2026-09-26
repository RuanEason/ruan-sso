import { prisma } from "@/lib/db"
import { recordAudit, type AuditActor } from "@/lib/audit/log"
import { userCanAccessClient } from "@/lib/org/access"
import { issueAuthorizationCode } from "@/lib/oidc/token"
import { buildRedirectWithCode, scopesCovered } from "@/lib/oidc/validate"
import type { AuthorizeParams } from "@/lib/oidc/validate"

/**
 * Pure skip decision. Kept free of Prisma so it can be unit tested directly.
 *
 * Consents are skipped only when a stored consent already covers **every**
 * scope in the request:
 *
 * - `stored` null (never consented)                → do not skip
 * - stored covers the request (`openid profile` ⊇ `openid`) → skip
 * - request widens the grant (`openid` ⊉ `openid profile`) → do not skip
 *
 * The widening case is the one that matters: a client that adds a scope must
 * send the user back to the consent screen, otherwise a silent skip would
 * hand over a permission the user never saw.
 */
export function shouldSkipConsent(
  storedScopes: string | null | undefined,
  requestedScopes: string
): boolean {
  if (!storedScopes) return false
  // An empty request is not something to auto-approve; require a real request.
  if (!requestedScopes.split(/\s+/).filter(Boolean).length) return false
  return scopesCovered(storedScopes, requestedScopes)
}

/** Reads the stored consent scopes for a user/client pair; null when absent. */
export async function getStoredConsentScopes(
  userId: string,
  clientId: string
): Promise<string | null> {
  const existing = await prisma.consent.findUnique({
    where: { userId_clientId: { userId, clientId } },
    select: { scopes: true },
  })
  return existing?.scopes ?? null
}

export type ApproveFailure =
  | { reason: "no_org_access" }
  | { reason: "client_missing" }

export type ApproveResult =
  | { ok: true; scopes: string; redirectTo: string }
  | { ok: false; failure: ApproveFailure }

/**
 * The single "the user approved this" path: record consent, check organization
 * access, issue an authorization code and build the callback URL.
 *
 * Both the consent screen's "allow" action and the consent-skipping branch of
 * the authorize endpoint MUST go through this function. That is the whole point
 * of its existence: an earlier skipping implementation returned a callback URL
 * built by hand and never called `issueAuthorizationCode`, so the browser was
 * redirected to the client without a `code` and the app could never obtain a
 * token. Routing every approval through one function makes "skipped but no
 * code issued" structurally impossible rather than merely unlikely.
 *
 * Callers are responsible for validating the request and resolving the session
 * user beforehand; this function assumes an authorized user and a valid client.
 */
export async function approveAndIssueCode(input: {
  userId: string
  clientDbId: string
  allowAllOrganizations: boolean
  /** When false the consent row is left untouched (a skip has no new grant). */
  recordConsent: boolean
  params: AuthorizeParams
  scopes: string
  /** Audit context. Optional so pure tests can call this without a request. */
  actor?: AuditActor | null
  request?: Request
  /** How approval was reached, recorded on the audit entry. */
  via?: "consent_screen" | "consent_skipped"
}): Promise<ApproveResult> {
  // Organization access is checked BEFORE any consent is written. Persisting
  // first would leave a consent record for a request that is then denied,
  // which both misrepresents what the user approved and changes how later
  // prompts (and skip decisions) render.
  const allowed = await userCanAccessClient(
    input.userId,
    input.clientDbId,
    input.allowAllOrganizations
  )
  if (!allowed) {
    await recordAudit({
      action: "CONSENT_DENIED",
      actor: input.actor ?? null,
      targetType: "app",
      targetId: input.params.client_id,
      request: input.request,
      metadata: {
        reason: "no_org_access",
        scopes: input.scopes,
        via: input.via ?? "consent_screen",
      },
    })
    return { ok: false, failure: { reason: "no_org_access" } }
  }

  if (input.recordConsent) {
    await prisma.consent.upsert({
      where: {
        userId_clientId: {
          userId: input.userId,
          clientId: input.params.client_id,
        },
      },
      create: {
        userId: input.userId,
        clientId: input.params.client_id,
        scopes: input.scopes,
      },
      update: { scopes: input.scopes },
    })

    await recordAudit({
      action: "CONSENT_GRANTED",
      actor: input.actor ?? null,
      targetType: "app",
      targetId: input.params.client_id,
      request: input.request,
      // Scopes are recorded: "what did the user actually agree to" is the
      // question this event exists to answer.
      metadata: { scopes: input.scopes, via: input.via ?? "consent_screen" },
    })
  }

  const code = await issueAuthorizationCode({
    clientId: input.params.client_id,
    userId: input.userId,
    redirectUri: input.params.redirect_uri,
    scopes: input.scopes,
    codeChallenge: input.params.code_challenge!,
    codeChallengeMethod: input.params.code_challenge_method ?? "S256",
    nonce: input.params.nonce,
  })

  // Recorded at the shared chokepoint, so a skip and an explicit approval are
  // both accounted for and neither can silently omit the event.
  await recordAudit({
    action: "TOKEN_ISSUED",
    actor: input.actor ?? null,
    targetType: "app",
    targetId: input.params.client_id,
    request: input.request,
    metadata: {
      scopes: input.scopes,
      via: input.via ?? "consent_screen",
      // The code itself is deliberately NOT recorded: the audit table must not
      // become a place where a redeemable credential can be read.
      issued: "authorization_code",
    },
  })

  return {
    ok: true,
    scopes: input.scopes,
    redirectTo: buildRedirectWithCode(
      input.params.redirect_uri,
      code,
      input.params.state
    ),
  }
}
