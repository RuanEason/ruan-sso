import { NextResponse } from "next/server"

import { buildDiscoveryDocument } from "@/lib/oidc/discovery"

export async function GET() {
  return NextResponse.json(buildDiscoveryDocument())
}
