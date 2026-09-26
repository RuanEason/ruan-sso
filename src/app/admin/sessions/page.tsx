"use client"

import { useEffect, useState } from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Spinner } from "@/components/ui/spinner"

type SessionRow = {
  id: string
  ip: string | null
  userAgent: string | null
  expiresAt: string
  createdAt: string
}

export default function AdminSessionsPage() {
  const [sessions, setSessions] = useState<SessionRow[]>([])
  const [loading, setLoading] = useState(true)

  // Fetches are started from an effect, but state is only written from the
  // async continuation, never synchronously during the effect body: setting
  // state synchronously there causes a cascading render on every mount.
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const res = await fetch("/api/admin/sessions")
      const data = await res.json()
      if (cancelled) return
      setSessions(data.sessions ?? [])
      setLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [])

  /** Re-fetch after a mutation. Safe to call from event handlers. */
  async function reload() {
    setLoading(true)
    const res = await fetch("/api/admin/sessions")
    const data = await res.json()
    setSessions(data.sessions ?? [])
    setLoading(false)
  }

  async function revoke(id: string) {
    const res = await fetch(`/api/admin/sessions?id=${encodeURIComponent(id)}`, {
      method: "DELETE",
    })
    if (!res.ok) {
      toast.error("撤销失败")
      return
    }
    toast.success("会话已撤销")
    await reload()
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">会话</h1>
        <p className="text-sm text-muted-foreground">当前管理员账号的活跃会话</p>
      </div>

      {loading ? (
        <Spinner />
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>创建时间</TableHead>
                <TableHead>IP</TableHead>
                <TableHead>User-Agent</TableHead>
                <TableHead>过期时间</TableHead>
                <TableHead className="text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sessions.map((s) => (
                <TableRow key={s.id}>
                  <TableCell className="text-sm">
                    {new Date(s.createdAt).toLocaleString()}
                  </TableCell>
                  <TableCell>{s.ip || "—"}</TableCell>
                  <TableCell className="max-w-xs truncate text-xs">
                    {s.userAgent || "—"}
                  </TableCell>
                  <TableCell className="text-sm">
                    {new Date(s.expiresAt).toLocaleString()}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button size="sm" variant="outline" onClick={() => void revoke(s.id)}>
                      撤销
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}
