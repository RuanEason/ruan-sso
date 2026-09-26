"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { LogOutIcon, ShieldCheckIcon } from "lucide-react"

import type { SessionUser } from "@/lib/auth/session"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

/**
 * Portal header: identity, the way into /account, and sign-out.
 *
 * The /account entry lives here because the portal is the page every
 * non-administrator now lands on, and until this existed /account was reachable
 * from nowhere in the application at all.
 */
export function PortalHeader({ user }: { user: SessionUser }) {
  const router = useRouter()

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" })
    router.push("/login")
    router.refresh()
  }

  return (
    <header className="border-b bg-background">
      <div className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between gap-4 px-6">
        <div className="flex items-baseline gap-2">
          <Link href="/portal" className="text-lg font-semibold tracking-tight">
            RUAN
          </Link>
          <span className="text-xs text-muted-foreground">统一身份认证中心</span>
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-accent">
            <Avatar className="size-8">
              <AvatarFallback>
                {user.displayName.slice(0, 2).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <span className="hidden font-medium sm:inline">
              {user.displayName}
            </span>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuItem render={<Link href="/account" />}>
              <ShieldCheckIcon />
              已授权的应用
            </DropdownMenuItem>
            {user.role === "ADMIN" ? (
              <DropdownMenuItem render={<Link href="/admin" />}>
                管理后台
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuItem onClick={logout}>
              <LogOutIcon />
              退出登录
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  )
}
