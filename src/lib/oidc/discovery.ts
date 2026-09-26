import { getAppUrl, allowHs256 } from "@/lib/env"
import { endpointUrl } from "@/lib/oidc/endpoints"

/**
 * Builds the OpenID Connect discovery document.
 *
 * The `/.well-known/openid-configuration` route and the integration docs both
 * render this exact object, so the documented metadata can never drift from the
 * metadata actually served.
 *
 * Tokens are signed with RS256 and verified against the published `jwks_uri`,
 * so relying parties never hold a signing secret.
 */
export function buildDiscoveryDocument() {
  const issuer = getAppUrl()
  return {
    issuer,
    authorization_endpoint: endpointUrl(issuer, "authorize"),
    token_endpoint: endpointUrl(issuer, "token"),
    userinfo_endpoint: endpointUrl(issuer, "userinfo"),
    end_session_endpoint: endpointUrl(issuer, "logout"),
    jwks_uri: endpointUrl(issuer, "jwks"),
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    subject_types_supported: ["public"],
    // HS256 is advertised only while the transitional flag is on, so the
    // document always describes what the server actually accepts.
    id_token_signing_alg_values_supported: allowHs256()
      ? ["RS256", "HS256"]
      : ["RS256"],
    token_endpoint_auth_methods_supported: ["client_secret_post", "client_secret_basic", "none"],
    code_challenge_methods_supported: ["S256"],
    scopes_supported: ["openid", "profile", "email"],
    claims_supported: [
      "sub",
      "iss",
      "aud",
      "exp",
      "iat",
      "auth_time",
      "nonce",
      "at_hash",
      "name",
      "preferred_username",
      "email",
      "email_verified",
    ],
  }
}
