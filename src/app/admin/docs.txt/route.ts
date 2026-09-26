import { buildAiDocText } from "@/lib/docs/oidc-docs"

/**
 * Public, machine-readable integration guide.
 *
 * Intentionally NOT behind the admin login: AI tools and scripts cannot
 * authenticate, so gating this would make it unreachable. Only protocol-level
 * information is exposed here — no credentials, no user data.
 */
export const dynamic = "force-dynamic"

export async function GET(request: Request) {
  const origin = new URL(request.url).origin
  return new Response(buildAiDocText(origin), {
    status: 200,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "public, max-age=300",
    },
  })
}
