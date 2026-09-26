/**
 * Post-login destination logic, in a module with **no imports at all**.
 *
 * Why its own module rather than a function in `lib/oidc/validate.ts`: both the
 * login form (`"use client"`) and the server-side authorize flow need this
 * decision. `validate.ts` imports `@/lib/env`, which reaches server-only
 * configuration (signing keys, database URL), so a client component importing
 * from it would pull that graph into the browser bundle. This module depends on
 * nothing, so either side may import it safely.
 *
 * An earlier revision had two hand-copied implementations of `isSafeReturnTo` —
 * one here and one inlined in the login form — that had to be kept in step by
 * comment. They are now one function; there is no second copy to drift.
 */

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

/** Where the portal lives. Exported so no caller hardcodes the string twice. */
export const PORTAL_PATH = "/portal"

/** Where administrators land. */
export const ADMIN_HOME_PATH = "/admin"

type Role = "ADMIN" | "USER"

/**
 * Resolves the page a user should land on after signing in.
 *
 * - A safe `returnTo` always wins. This is the case that must not change: a user
 *   arriving from an app is sent through `/oauth/authorize` and has to be
 *   returned there, or the authorization flow never completes.
 * - With no `returnTo` there is genuinely nowhere specific to go, so the landing
 *   page is chosen by role. Users go to the portal; administrators go to the
 *   admin console, which is the only area they can use anyway.
 * - An *unsafe* `returnTo` is treated as absent rather than coerced to a fixed
 *   path. Previously an unsafe value silently became `/admin`, which sent every
 *   non-admin into a redirect loop (admin layout bounces them back to /login).
 *
 * The previous default of `/admin` was the bug: a plain user who visited
 * `/login` directly was sent to `/admin`, denied by the admin layout, and
 * bounced back to `/login` with no explanation and nowhere to go.
 */
export function resolvePostLoginDestination(input: {
  returnTo: string | null | undefined
  role: Role | null | undefined
}): string {
  const { returnTo, role } = input
  if (isSafeReturnTo(returnTo)) return returnTo as string
  return role === "ADMIN" ? ADMIN_HOME_PATH : PORTAL_PATH
}
