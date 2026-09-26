import { NextResponse } from "next/server"

import { buildJwks } from "@/lib/auth/keys"

/**
 * Public JSON Web Key Set.
 *
 * This is what lets a relying party verify `id_token` / `access_token` without
 * ever holding a signing secret. Cached aggressively because the key set only
 * changes on rotation.
 */
export async function GET() {
  const jwks = await buildJwks()
  return NextResponse.json(jwks, {
    headers: { "Cache-Control": "public, max-age=3600" },
  })
}
