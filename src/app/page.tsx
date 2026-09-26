import { redirect } from "next/navigation"

import { getSessionUser } from "@/lib/auth/session"

export default async function HomePage() {
  const user = await getSessionUser()
  if (user?.role === "ADMIN") {
    redirect("/admin")
  }
  redirect("/login")
}
