/**
 * Paths for the three documentation views.
 *
 * Kept in its own dependency-free module so `src/middleware.ts` (Edge runtime)
 * can reference them without pulling the documentation generators or Prisma
 * into the middleware bundle.
 *
 * `text` and `json` are deliberately public: AI tools and scripts cannot
 * authenticate, so requiring a login would make them unreachable. `human` stays
 * behind the admin login.
 */
export const PUBLIC_DOC_PATHS = {
  human: "/admin/docs",
  text: "/admin/docs.txt",
  json: "/admin/docs.json",
} as const

/** Exact paths exempted from the /admin login check. Matched exactly, never by prefix. */
export const PUBLIC_MACHINE_DOC_PATHS: readonly string[] = [
  PUBLIC_DOC_PATHS.text,
  PUBLIC_DOC_PATHS.json,
]
