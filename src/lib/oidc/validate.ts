import type { OAuthClient } from "@prisma/client"

import { DEFAULT_SCOPES } from "@/lib/env"

export type AuthorizeParams = {
  client_id: string
  redirect_uri: string
  response_type: string
  scope?: string
  state?: string
  code_challenge?: string
  code_challenge_method?: string
  nonce?: string
}

export function parseAuthorizeParams(
  searchParams: URLSearchParams
): AuthorizeParams {
  return {
    client_id: searchParams.get("client_id") ?? "",
    redirect_uri: searchParams.get("redirect_uri") ?? "",
    response_type: searchParams.get("response_type") ?? "",
    scope: searchParams.get("scope") ?? undefined,
    state: searchParams.get("state") ?? undefined,
    code_challenge: searchParams.get("code_challenge") ?? undefined,
    code_challenge_method: searchParams.get("code_challenge_method") ?? undefined,
    nonce: searchParams.get("nonce") ?? undefined,
  }
}

export function validateAuthorizeRequest(
  params: AuthorizeParams,
  client: OAuthClient | null
): { ok: true; scopes: string } | { ok: false; error: string; description: string } {
  if (!params.client_id) {
    return { ok: false, error: "invalid_request", description: "client_id is required" }
  }
  if (!client || client.status !== "ACTIVE") {
    return { ok: false, error: "invalid_client", description: "Unknown or disabled client" }
  }
  if (params.response_type !== "code") {
    return {
      ok: false,
      error: "unsupported_response_type",
      description: "Only response_type=code is supported",
    }
  }
  if (!params.redirect_uri) {
    return { ok: false, error: "invalid_request", description: "redirect_uri is required" }
  }

  const redirectUris = parseRedirectUris(client.redirectUris)
  if (!redirectUris.includes(params.redirect_uri)) {
    return {
      ok: false,
      error: "invalid_request",
      description: "redirect_uri is not registered",
    }
  }

  if (!params.code_challenge) {
    return {
      ok: false,
      error: "invalid_request",
      description: "code_challenge is required (PKCE)",
    }
  }
  const method = params.code_challenge_method ?? "S256"
  if (method !== "S256") {
    return {
      ok: false,
      error: "invalid_request",
      description: "Only code_challenge_method=S256 is supported",
    }
  }

  const requested = (params.scope ?? "openid profile email")
    .split(/\s+/)
    .filter(Boolean)
  if (!requested.includes("openid")) {
    return {
      ok: false,
      error: "invalid_scope",
      description: "scope must include openid",
    }
  }

  const allowed = new Set(
    client.allowedScopes.split(/\s+/).filter(Boolean).length
      ? client.allowedScopes.split(/\s+/).filter(Boolean)
      : [...DEFAULT_SCOPES]
  )
  for (const s of requested) {
    if (!allowed.has(s)) {
      return {
        ok: false,
        error: "invalid_scope",
        description: `scope ${s} is not allowed`,
      }
    }
  }

  return { ok: true, scopes: requested.join(" ") }
}

export function parseRedirectUris(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map(String)
  }
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value)
      if (Array.isArray(parsed)) return parsed.map(String)
    } catch {
      return value.split(/\s+/).filter(Boolean)
    }
  }
  return []
}

export function buildRedirectWithCode(
  redirectUri: string,
  code: string,
  state?: string
): string {
  const url = new URL(redirectUri)
  url.searchParams.set("code", code)
  if (state) url.searchParams.set("state", state)
  return url.toString()
}

export function buildRedirectWithError(
  redirectUri: string,
  error: string,
  description?: string,
  state?: string
): string {
  const url = new URL(redirectUri)
  url.searchParams.set("error", error)
  if (description) url.searchParams.set("error_description", description)
  if (state) url.searchParams.set("state", state)
  return url.toString()
}

export function scopesCovered(granted: string, requested: string): boolean {
  const have = new Set(granted.split(/\s+/).filter(Boolean))
  return requested
    .split(/\s+/)
    .filter(Boolean)
    .every((s) => have.has(s))
}

export function authorizeReturnTo(params: AuthorizeParams): string {
  const q = new URLSearchParams()
  q.set("client_id", params.client_id)
  q.set("redirect_uri", params.redirect_uri)
  q.set("response_type", params.response_type)
  if (params.scope) q.set("scope", params.scope)
  if (params.state) q.set("state", params.state)
  if (params.code_challenge) q.set("code_challenge", params.code_challenge)
  if (params.code_challenge_method) {
    q.set("code_challenge_method", params.code_challenge_method)
  }
  if (params.nonce) q.set("nonce", params.nonce)
  return `/oauth/authorize?${q.toString()}`
}

/**
 * Whether a post-login redirect target is safe to send the browser to.
 *
 * A leading `/` alone is not sufficient: `//evil.com` and `/\evil.com` are
 * protocol-relative URLs that browsers resolve to another origin, so a naive
 * `startsWith("/")` check turns `returnTo` into an open redirect after a
 * successful login. Only same-origin absolute paths are allowed.
 */
export function isSafeReturnTo(value: string | null | undefined): boolean {
  if (!value) return false
  if (!value.startsWith("/")) return false
  // Reject protocol-relative ("//host") and backslash variants of it.
  if (value.startsWith("//") || value.startsWith("/\\")) return false
  return true
}
