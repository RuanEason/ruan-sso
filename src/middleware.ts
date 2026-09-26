import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"

import { PUBLIC_MACHINE_DOC_PATHS } from "@/lib/docs/paths"
import { SESSION_COOKIE } from "@/lib/env"

/**
 * Optimistic pre-check only: this verifies that a session cookie is *present*,
 * not that it is valid. Authoritative authorization happens in
 * `src/app/admin/layout.tsx`, which resolves the session against the database.
 * (Next.js is explicit that Proxy/Middleware must not be the sole authorization
 * layer — see node_modules/next/dist/docs/01-app/01-getting-started/16-proxy.md.)
 *
 * This runs on the Edge runtime, so it must not import Prisma-backed helpers.
 */
export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // The machine-readable integration docs are deliberately public: AI tools and
  // scripts cannot log in, so requiring a session would make them unreachable.
  // Matched EXACTLY (never by prefix) so no other /admin route is exposed and
  // paths like /admin/docs.txt.evil still fall through to the login redirect.
  if (PUBLIC_MACHINE_DOC_PATHS.includes(pathname)) {
    return NextResponse.next()
  }

  if (!pathname.startsWith("/admin")) {
    return NextResponse.next()
  }

  const token = request.cookies.get(SESSION_COOKIE)?.value
  if (!token) {
    const login = new URL("/login", request.url)
    login.searchParams.set("returnTo", pathname)
    return NextResponse.redirect(login)
  }

  return NextResponse.next()
}

export const config = {
  matcher: ["/admin/:path*"],
}
