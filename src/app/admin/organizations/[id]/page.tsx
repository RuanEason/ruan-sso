"use client"

import Link from "next/link"
import { useParams } from "next/navigation"
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
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Spinner } from "@/components/ui/spinner"

type Member = {
  id: string
  role: string
  user: {
    id: string
    username: string
    email: string
    displayName: string
    status: string
  }
}

type OrgDetail = {
  id: string
  slug: string
  name: string
  description: string | null
  type: string
  status: string
  allowSelfRegister: boolean
  members: Member[]
}

export default function AdminOrganizationDetailPage() {
  const params = useParams<{ id: string }>()
  const [org, setOrg] = useState<OrgDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [pending, setPending] = useState(false)

  async function load() {
    // No synchronous setState before the first await (see the effect below).
    const res = await fetch(`/api/admin/organizations/${params.id}`)
    const data = await res.json()
    if (!res.ok) {
      toast.error(data.error || "加载失败")
      setLoading(false)
      return
    }
    setOrg(data.organization)
    setLoading(false)
  }

  // State is written only from the async continuation, never synchronously in
  // the effect body (react-hooks/set-state-in-effect). Re-runs when the route
  // id changes.
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const res = await fetch(`/api/admin/organizations/${params.id}`)
      const data = await res.json()
      if (cancelled) return
      if (!res.ok) {
        toast.error(data.error || "加载失败")
        setLoading(false)
        return
      }
      setOrg(data.organization)
      setLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [params.id])

  /** Re-fetch from an event handler, showing the spinner while it runs. */
  async function refresh() {
    setLoading(true)
    await load()
  }

  async function addMember(form: FormData) {
    setPending(true)
    const res = await fetch(`/api/admin/organizations/${params.id}/members`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: form.get("username"),
        role: form.get("role") || "MEMBER",
      }),
    })
    setPending(false)
    const data = await res.json()
    if (!res.ok) {
      toast.error(data.error || "添加失败")
      return
    }
    toast.success("成员已添加")
    await refresh()
  }

  async function removeMember(userId: string) {
    const res = await fetch(
      `/api/admin/organizations/${params.id}/members?userId=${encodeURIComponent(userId)}`,
      { method: "DELETE" }
    )
    if (!res.ok) {
      toast.error("移除失败")
      return
    }
    toast.success("已移除")
    await refresh()
  }

  if (loading) return <Spinner />
  if (!org) {
    return <p className="text-sm text-muted-foreground">组织不存在</p>
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="w-fit px-0"
            nativeButton={false}
            render={<Link href="/admin/organizations" />}
          >
            ← 返回组织列表
          </Button>
          <h1 className="text-2xl font-semibold tracking-tight">{org.name}</h1>
          <p className="text-sm text-muted-foreground">
            {org.slug} · {org.type}
            {org.allowSelfRegister ? " · 允许自助注册" : ""}
          </p>
        </div>
        <Badge variant={org.status === "ACTIVE" ? "default" : "outline"}>
          {org.status}
        </Badge>
      </div>

      {org.description ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">说明</CardTitle>
            <CardDescription>{org.description}</CardDescription>
          </CardHeader>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">添加成员</CardTitle>
          <CardDescription>按用户名将已有账号加入本组织</CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="flex flex-wrap items-end gap-3"
            onSubmit={(e) => {
              e.preventDefault()
              void addMember(new FormData(e.currentTarget))
              e.currentTarget.reset()
            }}
          >
            <FieldGroup className="flex-1 min-w-48">
              <Field>
                <FieldLabel htmlFor="username">用户名</FieldLabel>
                <Input id="username" name="username" required placeholder="username" />
              </Field>
            </FieldGroup>
            <select
              name="role"
              className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm"
              defaultValue="MEMBER"
            >
              <option value="MEMBER">MEMBER</option>
              <option value="ADMIN">ADMIN</option>
              <option value="OWNER">OWNER</option>
            </select>
            <Button type="submit" disabled={pending}>
              {pending ? <Spinner data-icon="inline-start" /> : null}
              添加
            </Button>
          </form>
        </CardContent>
      </Card>

      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>用户名</TableHead>
              <TableHead>显示名</TableHead>
              <TableHead>邮箱</TableHead>
              <TableHead>组织角色</TableHead>
              <TableHead className="text-right">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {org.members.map((m) => (
              <TableRow key={m.id}>
                <TableCell className="font-medium">{m.user.username}</TableCell>
                <TableCell>{m.user.displayName}</TableCell>
                <TableCell>{m.user.email}</TableCell>
                <TableCell>
                  <Badge variant="secondary">{m.role}</Badge>
                </TableCell>
                <TableCell className="text-right">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void removeMember(m.user.id)}
                  >
                    移除
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
