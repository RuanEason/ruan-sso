import { redirect } from "next/navigation"

import { getSessionUser } from "@/lib/auth/session"
import { AdminShell } from "@/components/admin/admin-shell"

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const user = await getSessionUser()
  if (!user) {
    redirect("/login?returnTo=/admin")
  }
  if (user.role !== "ADMIN") {
    redirect("/login?error=forbidden")
  }

  return <AdminShell user={user}>{children}</AdminShell>
}
