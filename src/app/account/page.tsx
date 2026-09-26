"use client"

import { useEffect, useState } from "react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Spinner } from "@/components/ui/spinner"

type ConsentRow = {
  id: string
  scopes: string
  clientId: string
  clientName: string
  clientStatus: "ACTIVE" | "DISABLED"
}

export default function AccountPage() {
  const [consents, setConsents] = useState<ConsentRow[]>([])
  const [loading, setLoading] = useState(true)
  const [pending, setPending] = useState<string | null>(null)

  // State is written only from the async continuation, never synchronously in
  // the effect body (react-hooks/set-state-in-effect).
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const res = await fetch("/api/account/consents")
      const data = await res.json()
      if (cancelled) return
      setConsents(data.consents ?? [])
      setLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [])

  async function revoke(row: ConsentRow) {
    setPending(row.id)
    const res = await fetch(
      `/api/account/consents?client_id=${encodeURIComponent(row.clientId)}`,
      { method: "DELETE" }
    )
    setPending(null)
    if (!res.ok) {
      toast.error("撤销失败")
      return
    }
    toast.success(`已撤销对 ${row.clientName} 的授权`)
    setConsents((prev) => prev.filter((c) => c.id !== row.id))
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">已授权的应用</h1>
        <p className="text-sm text-muted-foreground">
          这些应用已获得你的长期授权，登录时不会再询问。撤销后，下次登录会重新显示授权页面。
        </p>
      </div>

      {loading ? (
        <Spinner />
      ) : consents.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>暂无已授权的应用</CardTitle>
            <CardDescription>
              你还没有授权任何应用；每次登录都会显示授权页面。
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <div className="flex flex-col gap-4">
          {consents.map((c) => (
            <Card key={c.id}>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  {c.clientName}
                  {c.clientStatus === "DISABLED" ? (
                    <Badge variant="outline">已禁用</Badge>
                  ) : null}
                </CardTitle>
                <CardDescription className="font-mono text-xs">
                  {c.clientId}
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                <div className="flex flex-wrap gap-2">
                  {c.scopes
                    .split(/\s+/)
                    .filter(Boolean)
                    .map((s) => (
                      <Badge key={s} variant="secondary">
                        {s}
                      </Badge>
                    ))}
                </div>
                <div>
                  <Button
                    variant="outline"
                    disabled={pending === c.id}
                    onClick={() => void revoke(c)}
                  >
                    {pending === c.id ? (
                      <Spinner data-icon="inline-start" />
                    ) : null}
                    撤销授权
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
