"use client"

import Link from "next/link"
import { useEffect, useState } from "react"
import { PlusIcon } from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Spinner } from "@/components/ui/spinner"

type OrgRow = {
  id: string
  slug: string
  name: string
  description: string | null
  type: "ENTERPRISE" | "GROUP" | "PUBLIC"
  status: "ACTIVE" | "DISABLED"
  allowSelfRegister: boolean
  memberCount: number
  clientCount: number
}

const typeLabel: Record<OrgRow["type"], string> = {
  ENTERPRISE: "企业",
  GROUP: "团体",
  PUBLIC: "公开",
}

export default function AdminOrganizationsPage() {
  const [orgs, setOrgs] = useState<OrgRow[]>([])
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState(false)

  async function load() {
    // No synchronous setState before the first await (see the effect below).
    const res = await fetch("/api/admin/organizations")
    const data = await res.json()
    setOrgs(data.organizations ?? [])
    setLoading(false)
  }

  // State is written only from the async continuation, never synchronously in
  // the effect body (react-hooks/set-state-in-effect).
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const res = await fetch("/api/admin/organizations")
      const data = await res.json()
      if (cancelled) return
      setOrgs(data.organizations ?? [])
      setLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [])

  /** Re-fetch from an event handler, showing the spinner while it runs. */
  async function refresh() {
    setLoading(true)
    await load()
  }

  async function createOrg(form: FormData) {
    setPending(true)
    const type = String(form.get("type") || "GROUP") as OrgRow["type"]
    const res = await fetch("/api/admin/organizations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        slug: form.get("slug"),
        name: form.get("name"),
        description: form.get("description") || undefined,
        type,
        allowSelfRegister: type === "PUBLIC",
      }),
    })
    setPending(false)
    const data = await res.json()
    if (!res.ok) {
      toast.error(data.error || "创建失败")
      return
    }
    toast.success("组织已创建")
    setOpen(false)
    await refresh()
  }

  async function toggleStatus(org: OrgRow) {
    const res = await fetch(`/api/admin/organizations/${org.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        status: org.status === "ACTIVE" ? "DISABLED" : "ACTIVE",
      }),
    })
    if (!res.ok) {
      toast.error("操作失败")
      return
    }
    toast.success("已更新")
    await refresh()
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">组织</h1>
          <p className="text-sm text-muted-foreground">
            企业 / 团体 / 公开组织，用于约束用户与应用可见范围
          </p>
        </div>
        <Button onClick={() => setOpen(true)}>
          <PlusIcon data-icon="inline-start" />
          新建组织
        </Button>
      </div>

      {loading ? (
        <Spinner />
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>名称</TableHead>
                <TableHead>Slug</TableHead>
                <TableHead>类型</TableHead>
                <TableHead>成员</TableHead>
                <TableHead>自助注册</TableHead>
                <TableHead>状态</TableHead>
                <TableHead className="text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {orgs.map((o) => (
                <TableRow key={o.id}>
                  <TableCell className="font-medium">{o.name}</TableCell>
                  <TableCell className="font-mono text-xs">{o.slug}</TableCell>
                  <TableCell>
                    <Badge variant="secondary">{typeLabel[o.type]}</Badge>
                  </TableCell>
                  <TableCell>{o.memberCount}</TableCell>
                  <TableCell>{o.allowSelfRegister ? "是" : "否"}</TableCell>
                  <TableCell>
                    <Badge variant={o.status === "ACTIVE" ? "default" : "outline"}>
                      {o.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        nativeButton={false}
                        render={<Link href={`/admin/organizations/${o.id}`} />}
                      >
                        管理
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => void toggleStatus(o)}>
                        {o.status === "ACTIVE" ? "禁用" : "启用"}
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>新建组织</DialogTitle>
            <DialogDescription>
              PUBLIC 类型默认允许自助注册；企业与团体需管理员加人
            </DialogDescription>
          </DialogHeader>
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault()
              void createOrg(new FormData(e.currentTarget))
            }}
          >
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="name">名称</FieldLabel>
                <Input id="name" name="name" required />
              </Field>
              <Field>
                <FieldLabel htmlFor="slug">Slug</FieldLabel>
                <Input
                  id="slug"
                  name="slug"
                  required
                  placeholder="my-org"
                  pattern="[a-z0-9\-]+"
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="type">类型</FieldLabel>
                <select
                  id="type"
                  name="type"
                  className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm"
                  defaultValue="GROUP"
                >
                  <option value="ENTERPRISE">企业 ENTERPRISE</option>
                  <option value="GROUP">团体 GROUP</option>
                  <option value="PUBLIC">公开 PUBLIC</option>
                </select>
              </Field>
              <Field>
                <FieldLabel htmlFor="description">说明</FieldLabel>
                <Textarea id="description" name="description" rows={3} />
              </Field>
            </FieldGroup>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                取消
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? <Spinner data-icon="inline-start" /> : null}
                创建
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
