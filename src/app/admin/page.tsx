import {
  AppWindowIcon,
  Building2Icon,
  MonitorSmartphoneIcon,
  UsersIcon,
} from "lucide-react"

import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { prisma } from "@/lib/db"

/**
 * These counts are live data, so the page must be rendered per request.
 * Without this, Next.js would prerender the dashboard at build time (requiring
 * a database just to compile) and then serve permanently frozen statistics.
 */
export const dynamic = "force-dynamic"

export default async function AdminDashboardPage() {
  const [userCount, appCount, orgCount, sessionCount] = await Promise.all([
    prisma.user.count(),
    prisma.oAuthClient.count(),
    prisma.organization.count(),
    prisma.session.count({ where: { expiresAt: { gt: new Date() } } }),
  ])

  const stats = [
    { label: "组织", value: orgCount, icon: Building2Icon },
    { label: "用户", value: userCount, icon: UsersIcon },
    { label: "应用", value: appCount, icon: AppWindowIcon },
    { label: "活跃会话", value: sessionCount, icon: MonitorSmartphoneIcon },
  ]

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">概览</h1>
        <p className="text-sm text-muted-foreground">RUAN SSO 运行状态</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((s) => (
          <Card key={s.label}>
            <CardHeader className="flex flex-row items-center justify-between gap-2">
              <div className="flex flex-col gap-1">
                <CardDescription>{s.label}</CardDescription>
                <CardTitle className="text-3xl tabular-nums">{s.value}</CardTitle>
              </div>
              <s.icon className="size-5 text-muted-foreground" />
            </CardHeader>
          </Card>
        ))}
      </div>
    </div>
  )
}
