/**
 * Canonical OIDC/OAuth endpoint paths.
 *
 * These are the single source of truth for every path this SSO serves. Both the
 * discovery document and the integration docs are built from these constants, so
 * a path can never be documented differently from the path that actually exists.
 */
export const OIDC_PATHS = {
  discovery: "/.well-known/openid-configuration",
  jwks: "/.well-known/jwks.json",
  authorize: "/oauth/authorize",
  token: "/oauth/token",
  userinfo: "/oauth/userinfo",
  logout: "/oauth/logout",
} as const

export type OidcEndpointKey = keyof typeof OIDC_PATHS

/** Join the configured issuer with an endpoint path. */
export function endpointUrl(issuer: string, key: OidcEndpointKey): string {
  return `${issuer}${OIDC_PATHS[key]}`
}
