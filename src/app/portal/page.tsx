import Link from "next/link"
import { redirect } from "next/navigation"
import { AlertCircleIcon } from "lucide-react"

import { PortalAppGrid, type PortalAppCard } from "@/components/portal-app-grid"
import { PortalHeader } from "@/components/portal-header"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { getSessionUser } from "@/lib/auth/session"
import { prisma } from "@/lib/db"
import { DEFAULT_SCOPES } from "@/lib/env"
import { scopesCovered } from "@/lib/oidc/validate"
import { primaryRedirectUri, visibleAppsForUser } from "@/lib/portal"
import { ADMIN_HOME_PATH } from "@/lib/return-to"

/** Explains a failed launch, which `/portal/launch/<id>` reports via `?error=`. */
const LAUNCH_ERRORS: Record<string, string> = {
  unknown_app: "该应用不存在或已被禁用。",
  no_access: "你不属于该应用允许的组织，无法使用。",
  no_redirect_uri: "该应用未配置回调地址，请联系管理员。",
}

async function launchErrorMessage(
  searchParams: Promise<Record<string, string | string[] | undefined>>
): Promise<string | null> {
  const sp = await searchParams
  const raw = sp.error
  const key = Array.isArray(raw) ? raw[0] : raw
  return key ? LAUNCH_ERRORS[key] ?? null : null
}

/**
 * The application portal: the landing page for a user who signed in without
 * coming from an application.
 *
 * It is navigation only. Each card links to `/portal/launch/<clientId>`, which
 * hands the browser to the application so that it starts its own authorization
 * request through the existing `/oauth/authorize` endpoint. Consent, the
 * organization access check and code issuance therefore all run through the
 * same server-side path they always did, and nothing here can issue a code.
 *
 * Visibility is decided by `visibleAppsForUser`, which mirrors
 * `userCanAccessClient` — the function the authorize endpoint enforces with. If
 * these two disagreed, a user would see an app here and be refused on clicking
 * it.
 */
export default async function PortalPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const user = await getSessionUser()
  if (!user) {
    redirect("/login?returnTo=/portal")
  }

  const launchError = await launchErrorMessage(searchParams)

  // Resolved in three queries rather than one per client: the client list is
  // small, but a per-client access check would turn rendering the portal into
  // N+1 round trips.
  const [clients, memberships, consents] = await Promise.all([
    prisma.oAuthClient.findMany({
      where: { status: "ACTIVE" },
      select: {
        id: true,
        clientId: true,
        name: true,
        allowedScopes: true,
        redirectUris: true,
        allowAllOrganizations: true,
        status: true,
        organizations: { select: { organizationId: true } },
      },
    }),
    prisma.organizationMember.findMany({
      where: { userId: user.id, organization: { status: "ACTIVE" } },
      select: { organizationId: true },
    }),
    prisma.consent.findMany({
      where: { userId: user.id },
      select: { clientId: true, scopes: true },
    }),
  ])

  const userOrgIds = new Set(memberships.map((m) => m.organizationId))
  const launchableClientIds = new Set(
    clients
      .filter((c) => primaryRedirectUri(c.redirectUris) !== null)
      .map((c) => c.clientId)
  )
  const grantedScopes = new Map(consents.map((c) => [c.clientId, c.scopes]))

  const apps: PortalAppCard[] = visibleAppsForUser(
    clients.map((c) => ({
      id: c.id,
      clientId: c.clientId,
      name: c.name,
      allowedScopes: c.allowedScopes,
      allowAllOrganizations: c.allowAllOrganizations,
      status: c.status,
      organizationIds: c.organizations.map((o) => o.organizationId),
    })),
    userOrgIds,
    DEFAULT_SCOPES
  ).map((app) => {
    const granted = grantedScopes.get(app.clientId)
    return {
      ...app,
      // False when the client has no registered callback: the card is shown but
      // cannot be launched, rather than sending the user into a flow that has
      // nowhere to return to.
      launchable: launchableClientIds.has(app.clientId),
      // Reflects the same coverage rule the authorize endpoint uses to decide
      // whether it can skip the consent screen, so the badge means "this will
      // not ask again" rather than merely "a consent row exists".
      granted: Boolean(granted && scopesCovered(granted, app.scopes)),
    }
  })

  return (
    <div className="min-h-svh bg-muted/40">
      <PortalHeader user={user} />
      <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">应用门户</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            选择一个应用开始使用。首次使用会请求你的授权。
          </p>
        </div>

        {launchError ? (
          <Alert variant="destructive">
            <AlertCircleIcon />
            <AlertTitle>无法启动该应用</AlertTitle>
            <AlertDescription>{launchError}</AlertDescription>
          </Alert>
        ) : null}

        {apps.length === 0 ? (
          <Card>
            <CardHeader>
              <CardTitle>暂无可访问的应用</CardTitle>
              <CardDescription>
                你当前不属于任何可使用应用的组织。请联系管理员把你加入对应组织。
              </CardDescription>
            </CardHeader>
          </Card>
        ) : (
          <PortalAppGrid apps={apps} />
        )}

        <p className="text-sm text-muted-foreground">
          想查看或撤销已授权的应用？前往{" "}
          <Link href="/account" className="underline underline-offset-4">
            已授权的应用
          </Link>
          。
        </p>

        {user.role === "ADMIN" ? (
          <p className="text-sm text-muted-foreground">
            你是管理员，可前往{" "}
            <Link href={ADMIN_HOME_PATH} className="underline underline-offset-4">
              管理后台
            </Link>
            。
          </p>
        ) : null}
      </main>
    </div>
  )
}
