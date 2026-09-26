import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

export type PortalAppCard = {
  id: string
  clientId: string
  name: string
  scopes: string
  /** Whether the user already has a standing grant covering `scopes`. */
  granted: boolean
  /** False when the client has no usable registered redirect URI. */
  launchable: boolean
}

/**
 * The application grid.
 *
 * Each card is an ordinary link to `/portal/launch/<clientId>`, which hands the
 * browser to the application so it can start its own authorization request.
 *
 * The portal deliberately does **not** build an authorization request or mint a
 * PKCE verifier here. Only the client that will redeem the code can hold the
 * verifier, so a portal-forged request cannot be completed by the app — an
 * earlier revision that tried it was rejected by the relying party with a state
 * mismatch. Nothing on this page can issue a code; issuance stays in
 * `approveAndIssueCode`, reached through `/oauth/authorize`.
 */
export function PortalAppGrid({ apps }: { apps: PortalAppCard[] }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {apps.map((app) => (
        <Card key={app.id} className="flex flex-col">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              {app.name}
              {app.granted ? <Badge variant="secondary">已授权</Badge> : null}
            </CardTitle>
            <CardDescription className="break-all font-mono text-xs">
              {app.clientId}
            </CardDescription>
          </CardHeader>
          <CardContent className="mt-auto">
            {app.launchable ? (
              // A plain anchor, deliberately not next/link: the launch route
              // redirects to the *application's* origin, so this navigation must
              // leave the app router entirely. Wrapped in Link it is intercepted
              // and prefetched as an RSC payload, which follows the cross-origin
              // redirect with `fetch` and fails CORS.
              <Button
                className="w-full"
                render={
                  <a href={`/portal/launch/${encodeURIComponent(app.clientId)}`} />
                }
              >
                进入应用
              </Button>
            ) : (
              <>
                <Button className="w-full" disabled>
                  无法启动
                </Button>
                <p className="mt-2 text-xs text-muted-foreground">
                  该应用未配置回调地址，请联系管理员。
                </p>
              </>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
