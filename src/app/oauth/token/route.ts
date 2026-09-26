import { NextResponse } from "next/server"

import { exchangeAuthorizationCode, exchangeRefreshToken } from "@/lib/oidc/token"

function parseBasicAuth(header: string | null): { id: string; secret: string } | null {
  if (!header?.startsWith("Basic ")) return null
  try {
    const decoded = Buffer.from(header.slice(6), "base64").toString("utf8")
    const idx = decoded.indexOf(":")
    if (idx < 0) return null
    return { id: decoded.slice(0, idx), secret: decoded.slice(idx + 1) }
  } catch {
    return null
  }
}

export async function POST(request: Request) {
  const contentType = request.headers.get("content-type") ?? ""
  let body: Record<string, string> = {}

  if (contentType.includes("application/json")) {
    body = (await request.json().catch(() => ({}))) as Record<string, string>
  } else {
    const form = await request.formData()
    form.forEach((value, key) => {
      body[key] = String(value)
    })
  }

  const basic = parseBasicAuth(request.headers.get("authorization"))
  const clientId = body.client_id || basic?.id || ""
  const clientSecret = body.client_secret ?? basic?.secret
  const grantType = body.grant_type

  if (grantType === "authorization_code") {
    if (!body.code || !body.redirect_uri || !body.code_verifier) {
      return NextResponse.json(
        { error: "invalid_request", error_description: "code, redirect_uri, code_verifier required" },
        { status: 400 }
      )
    }
    const result = await exchangeAuthorizationCode({
      code: body.code,
      clientId,
      clientSecret,
      redirectUri: body.redirect_uri,
      codeVerifier: body.code_verifier,
    })
    if ("error" in result) {
      return NextResponse.json(
        { error: result.error, error_description: result.description },
        { status: 400 }
      )
    }
    return NextResponse.json(result)
  }

  if (grantType === "refresh_token") {
    if (!body.refresh_token) {
      return NextResponse.json(
        { error: "invalid_request", error_description: "refresh_token required" },
        { status: 400 }
      )
    }
    const result = await exchangeRefreshToken({
      refreshToken: body.refresh_token,
      clientId,
      clientSecret,
    })
    if ("error" in result) {
      return NextResponse.json(
        { error: result.error, error_description: result.description },
        { status: 400 }
      )
    }
    return NextResponse.json(result)
  }

  return NextResponse.json(
    { error: "unsupported_grant_type", error_description: "Only authorization_code and refresh_token" },
    { status: 400 }
  )
}
