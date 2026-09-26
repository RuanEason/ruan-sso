"use client"

import Link from "next/link"
import { FormEvent, useState } from "react"
import { useRouter } from "next/navigation"
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
import { Spinner } from "@/components/ui/spinner"

export default function RegisterPage() {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setPending(true)
    const form = new FormData(e.currentTarget)
    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: form.get("username"),
          email: form.get("email"),
          displayName: form.get("displayName"),
          password: form.get("password"),
          organizationSlug: "public",
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || "注册失败")
        setPending(false)
        return
      }
      router.push("/login")
      router.refresh()
    } catch {
      setError("网络错误，请重试")
      setPending(false)
    }
  }

  return (
    <div className="flex min-h-svh flex-col items-center justify-center bg-muted p-6 md:p-10">
      <div className="w-full max-w-md">
        <Card>
          <CardContent className="p-6 md:p-8">
            <form className="flex flex-col gap-5" onSubmit={onSubmit}>
              <div className="flex flex-col items-center gap-2 text-center">
                <h1 className="text-2xl font-bold tracking-tight">注册 RUAN</h1>
                <p className="text-balance text-sm text-muted-foreground">
                  加入公开组织，企业与团体需管理员邀请
                </p>
              </div>
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="username">用户名</FieldLabel>
                  <Input id="username" name="username" required minLength={2} />
                </Field>
                <Field>
                  <FieldLabel htmlFor="email">邮箱</FieldLabel>
                  <Input id="email" name="email" type="email" required />
                </Field>
                <Field>
                  <FieldLabel htmlFor="displayName">显示名</FieldLabel>
                  <Input id="displayName" name="displayName" required />
                </Field>
                <Field>
                  <FieldLabel htmlFor="password">密码</FieldLabel>
                  <Input
                    id="password"
                    name="password"
                    type="password"
                    required
                    minLength={6}
                  />
                </Field>
              </FieldGroup>

              {error ? (
                <Alert variant="destructive">
                  <AlertCircleIcon />
                  <AlertTitle>无法注册</AlertTitle>
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              ) : null}

              <Button type="submit" disabled={pending} className="w-full">
                {pending ? <Spinner data-icon="inline-start" /> : null}
                注册并登录
              </Button>
              <FieldDescription className="text-center">
                已有账号？{" "}
                <Link href="/login" className="underline underline-offset-2">
                  去登录
                </Link>
              </FieldDescription>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
