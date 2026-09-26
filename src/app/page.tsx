import { redirect } from "next/navigation"

import { getSessionUser } from "@/lib/auth/session"
import { ADMIN_HOME_PATH, PORTAL_PATH } from "@/lib/return-to"

/**
 * The root is a dispatcher, not a page.
 *
 * A signed-in user has to have somewhere to land; before the portal existed the
 * only alternative was `/login`, which left a user who signed in directly with
 * nowhere to go. Administrators keep going to the admin console.
 */
export default async function HomePage() {
  const user = await getSessionUser()
  if (!user) {
    redirect("/login")
  }
  redirect(user.role === "ADMIN" ? ADMIN_HOME_PATH : PORTAL_PATH)
}
