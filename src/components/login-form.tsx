"use client"

import { FormEvent, Suspense, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { cn } from "cn"
import { AlertCircleIcon } from "lucide-react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { NetworkParticles } from "@/components/network-particles"
import { RuanLoader, RuanPageLoader } from "@/components/ruan-loader"

/**
 * A leading "/" is not enough: "//evil.com" is a protocol-relative URL that the
 * browser resolves to a different origin, so accepting it would turn returnTo
 * into an open redirect after login. Mirrors isSafeReturnTo in lib/oidc/validate.
 */
function isSafeReturnTo(value: string): boolean {
  return value.startsWith("/") && !value.startsWith("//") && !value.startsWith("/\\")
}

function LoginFormInner({
  className,
  ...props
}: React.ComponentProps<"div">) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const requestedReturnTo = searchParams.get("returnTo") || "/admin"
  const returnTo = isSafeReturnTo(requestedReturnTo) ? requestedReturnTo : "/admin"
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setPending(true)
    const form = new FormData(e.currentTarget)
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: form.get("username"),
          password: form.get("password"),
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || "登录失败")
        setPending(false)
        return
      }
      // `returnTo` is already validated above, so it is safe to navigate to.
      const dest =
        data.user?.role === "ADMIN" && returnTo === "/admin" ? "/admin" : returnTo
      router.push(dest)
      router.refresh()
    } catch {
      setError("网络错误，请重试")
      setPending(false)
    }
  }

  return (
    <div className={cn("flex flex-col gap-6", className)} {...props}>
      {pending ? <RuanPageLoader label="正在登录…" /> : null}
      <Card className="overflow-hidden p-0">
        <CardContent className="grid p-0 md:grid-cols-2">
          <form className="p-6 md:p-8" onSubmit={onSubmit}>
            <FieldGroup>
              <div className="flex flex-col items-center gap-2 text-center">
                <h1 className="text-2xl font-bold tracking-tight">RUAN</h1>
                <p className="text-balance text-muted-foreground">
                  登录统一身份认证中心
                </p>
              </div>
              <Field data-invalid={!!error || undefined}>
                <FieldLabel htmlFor="username">用户名或邮箱</FieldLabel>
                <Input
                  id="username"
                  name="username"
                  autoComplete="username"
                  placeholder="admin"
                  required
                  aria-invalid={!!error || undefined}
                />
              </Field>
              <Field data-invalid={!!error || undefined}>
                <FieldLabel htmlFor="password">密码</FieldLabel>
                <Input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  required
                  aria-invalid={!!error || undefined}
                />
              </Field>

              {error ? (
                <Alert variant="destructive">
                  <AlertCircleIcon />
                  <AlertTitle>无法登录</AlertTitle>
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              ) : null}

              <Field>
                <Button type="submit" disabled={pending} className="w-full">
                  {pending ? (
                    <RuanLoader size={20} data-icon="inline-start" />
                  ) : null}
                  {pending ? "登录中…" : "登录"}
                </Button>
              </Field>
              <FieldDescription className="text-center">
                公开组织可{" "}
                <a href="/register" className="underline underline-offset-2">
                  自助注册
                </a>
              </FieldDescription>
            </FieldGroup>
          </form>
          <div className="relative hidden min-h-80 overflow-hidden bg-[oklch(0.18_0.03_250)] md:block">
            <NetworkParticles />
            <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/35 to-transparent p-6">
              <p className="text-sm font-medium tracking-wide text-white/90">
                RUAN
              </p>
              <p className="mt-1 text-xs text-white/55">
                节点互联 · 统一身份
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
      <FieldDescription className="px-6 text-center">
        RUAN SSO · 安全登录受会话与权限保护
      </FieldDescription>
    </div>
  )
}

export function LoginForm(props: React.ComponentProps<"div">) {
  return (
    <Suspense fallback={<RuanPageLoader fullScreen={false} label="加载登录页…" />}>
      <LoginFormInner {...props} />
    </Suspense>
  )
}
