import { redirect } from "next/navigation"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { getSessionUser } from "@/lib/auth/session"
import { prisma } from "@/lib/db"
import { userCanAccessClient } from "@/lib/org/access"
import {
  authorizeReturnTo,
  parseAuthorizeParams,
  scopesCovered,
  validateAuthorizeRequest,
} from "@/lib/oidc/validate"
import { consentAction } from "./actions"

type Props = {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

export default async function ConsentPage({ searchParams }: Props) {
  const sp = await searchParams
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(sp)) {
    if (typeof v === "string") qs.set(k, v)
    else if (Array.isArray(v) && v[0]) qs.set(k, v[0])
  }

  const params = parseAuthorizeParams(qs)
  const user = await getSessionUser()
  if (!user) {
    redirect(`/login?returnTo=${encodeURIComponent(authorizeReturnTo(params))}`)
  }

  const client = await prisma.oAuthClient.findUnique({
    where: { clientId: params.client_id },
  })
  const validation = validateAuthorizeRequest(params, client)
  if (!validation.ok || !client) {
    return (
      <div className="flex min-h-svh items-center justify-center p-4">
        <Card className="max-w-md">
          <CardHeader>
            <CardTitle>授权请求无效</CardTitle>
            <CardDescription>
              {validation.ok ? "客户端不存在" : validation.description}
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    )
  }

  const canAccess = await userCanAccessClient(
    user.id,
    client.id,
    client.allowAllOrganizations
  )
  if (!canAccess) {
    return (
      <div className="flex min-h-svh items-center justify-center p-4">
        <Card className="max-w-md">
          <CardHeader>
            <CardTitle>无权访问此应用</CardTitle>
            <CardDescription>
              你不属于该应用允许的组织。请联系管理员将你加入对应组织后再试。
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    )
  }

  // This page never auto-approves: reaching it means either there is no stored
  // consent or the request widened the grant, and both cases require an
  // explicit click. The skip decision lives in the authorize endpoint
  // (shouldSkipConsent) and only fires for an already-covered request, so a
  // user is never silently approved past this screen.
  const existing = await prisma.consent.findUnique({
    where: {
      userId_clientId: { userId: user.id, clientId: params.client_id },
    },
  })
  const previouslyGranted = Boolean(
    existing && scopesCovered(existing.scopes, validation.scopes)
  )

  const scopes = validation.scopes.split(/\s+/).filter(Boolean)

  return (
    <div className="relative flex min-h-svh items-center justify-center overflow-hidden bg-background px-4">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,_oklch(0.92_0.02_250),_transparent_55%)]"
      />
      <Card className="relative z-10 w-full max-w-md">
        <CardHeader className="flex flex-col gap-2">
          <p className="text-sm font-medium text-muted-foreground">RUAN</p>
          <CardTitle>授权请求</CardTitle>
          <CardDescription>
            <span className="font-medium text-foreground">{client.name}</span>{" "}
            请求访问你的账号（{user.displayName}）
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {previouslyGranted ? (
            <p className="text-sm text-muted-foreground">
              你已授权过该应用，继续即沿用相同权限。
            </p>
          ) : null}
          <p className="text-sm text-muted-foreground">请求的权限范围</p>
          <div className="flex flex-wrap gap-2">
            {scopes.map((s) => (
              <Badge key={s} variant="secondary">
                {s}
              </Badge>
            ))}
          </div>
        </CardContent>
        <CardFooter className="flex gap-2">
          <form action={consentAction} className="flex-1">
            <input type="hidden" name="decision" value="deny" />
            <input type="hidden" name="authorize_query" value={qs.toString()} />
            <Button type="submit" variant="outline" className="w-full">
              拒绝
            </Button>
          </form>
          <form action={consentAction} className="flex-1">
            <input type="hidden" name="decision" value="allow" />
            <input type="hidden" name="authorize_query" value={qs.toString()} />
            <Button type="submit" className="w-full">
              同意
            </Button>
          </form>
        </CardFooter>
      </Card>
    </div>
  )
}
