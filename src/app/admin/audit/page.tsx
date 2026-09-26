"use client"

import { useCallback, useEffect, useState } from "react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Field, FieldLabel } from "@/components/ui/field"
import { Spinner } from "@/components/ui/spinner"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  AUDIT_ACTION_LABELS,
  AUDIT_ACTIONS,
  auditSeverity,
  type AuditSeverity,
} from "@/lib/audit/actions"

type AuditRow = {
  id: string
  action: keyof typeof AUDIT_ACTION_LABELS
  actorId: string | null
  actorName: string | null
  actorRole: string | null
  targetType: string | null
  targetId: string | null
  targetName: string | null
  ip: string | null
  userAgent: string | null
  metadata: Record<string, unknown> | null
  createdAt: string
}

const SEVERITY_VARIANT: Record<AuditSeverity, "default" | "secondary" | "outline" | "destructive"> = {
  neutral: "outline",
  success: "default",
  warning: "secondary",
  danger: "destructive",
}

/** Renders metadata as compact text. Values are React-escaped by default. */
function metadataText(metadata: Record<string, unknown> | null): string {
  if (!metadata) return "—"
  const parts = Object.entries(metadata)
    .filter(([, v]) => v !== null && v !== undefined && v !== "")
    .map(([k, v]) => `${k}=${String(v)}`)
  return parts.length ? parts.join("  ") : "—"
}

export default function AdminAuditPage() {
  const [rows, setRows] = useState<AuditRow[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(50)
  const [loading, setLoading] = useState(true)

  const [action, setAction] = useState("")
  const [actorId, setActorId] = useState("")

  const load = useCallback(async () => {
    const params = new URLSearchParams()
    params.set("page", String(page))
    if (action) params.set("action", action)
    if (actorId) params.set("actorId", actorId)
    const res = await fetch(`/api/admin/audit?${params.toString()}`)
    const data = await res.json()
    setRows(data.entries ?? [])
    setTotal(data.total ?? 0)
    setPageSize(data.pageSize ?? 50)
    setLoading(false)
  }, [page, action, actorId])

  // State is written only from the async continuation, never synchronously in
  // the effect body (react-hooks/set-state-in-effect): `load` awaits before
  // touching state.
  useEffect(() => {
    let cancelled = false
    void (async () => {
      await load()
      if (cancelled) return
    })()
    return () => {
      cancelled = true
    }
  }, [load])

  const lastPage = Math.max(1, Math.ceil(total / pageSize))

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">审计日志</h1>
        <p className="text-sm text-muted-foreground">
          登录、授权与管理员操作记录。仅可追加，不可在此修改或删除。
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-4">
        <Field className="w-64">
          <FieldLabel htmlFor="audit-action">事件类型</FieldLabel>
          {/* A native select: the project's Select is a Base UI compound
              component, and a plain control keeps filtering simple here. */}
          <select
            id="audit-action"
            className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
            value={action}
            onChange={(e) => {
              setPage(1)
              setAction(e.target.value)
            }}
          >
            <option value="">全部</option>
            {AUDIT_ACTIONS.map((a) => (
              <option key={a} value={a}>
                {AUDIT_ACTION_LABELS[a]}
              </option>
            ))}
          </select>
        </Field>
        <Field className="w-64">
          <FieldLabel htmlFor="audit-actor">操作者 ID</FieldLabel>
          <Input
            id="audit-actor"
            placeholder="按 actorId 精确过滤"
            value={actorId}
            onChange={(e) => {
              setPage(1)
              setActorId(e.target.value)
            }}
          />
        </Field>
        <Button
          variant="outline"
          onClick={() => {
            setPage(1)
            setAction("")
            setActorId("")
            void load()
          }}
        >
          重置
        </Button>
      </div>

      {loading ? (
        <Spinner />
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">没有匹配的记录。</p>
      ) : (
        <>
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>时间</TableHead>
                  <TableHead>事件</TableHead>
                  <TableHead>操作者</TableHead>
                  <TableHead>目标</TableHead>
                  <TableHead>IP</TableHead>
                  <TableHead>详情</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="whitespace-nowrap text-xs">
                      {new Date(r.createdAt).toLocaleString()}
                    </TableCell>
                    <TableCell>
                      <Badge variant={SEVERITY_VARIANT[auditSeverity(r.action)]}>
                        {AUDIT_ACTION_LABELS[r.action] ?? r.action}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs">
                      {r.actorName || "—"}
                      {r.actorRole ? (
                        <span className="text-muted-foreground"> ({r.actorRole})</span>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-xs">
                      {r.targetName || r.targetId || "—"}
                      {r.targetType ? (
                        <span className="text-muted-foreground"> · {r.targetType}</span>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-xs">{r.ip || "—"}</TableCell>
                    <TableCell className="max-w-md break-all font-mono text-xs text-muted-foreground">
                      {metadataText(r.metadata)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <div className="flex items-center justify-between gap-4">
            <p className="text-sm text-muted-foreground">
              共 {total} 条 · 第 {page} / {lastPage} 页
            </p>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                上一页
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= lastPage}
                onClick={() => setPage((p) => p + 1)}
              >
                下一页
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
