import { NextResponse } from "next/server"

import { buildAiDocJson } from "@/lib/docs/oidc-docs"

/**
 * Public, structured integration guide.
 *
 * Intentionally NOT behind the admin login: AI tools and scripts cannot
 * authenticate, so gating this would make it unreachable. Only protocol-level
 * information is exposed here — no credentials, no user data.
 */
export const dynamic = "force-dynamic"

export async function GET(request: Request) {
  const origin = new URL(request.url).origin
  const res = NextResponse.json(buildAiDocJson(origin))
  res.headers.set("cache-control", "public, max-age=300")
  return res
}
