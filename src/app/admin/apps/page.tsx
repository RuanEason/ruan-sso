"use client"

import { useEffect, useState } from "react"
import { PlusIcon } from "lucide-react"
import { toast } from "sonner"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
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

type OrgOption = { id: string; name: string; slug: string }

type AppRow = {
  id: string
  clientId: string
  name: string
  redirectUris: string[]
  allowedScopes: string
  isConfidential: boolean
  allowAllOrganizations: boolean
  organizations: OrgOption[]
  status: "ACTIVE" | "DISABLED"
  createdAt: string
}

function OrgPicker({
  orgs,
  allowAll,
  selectedOrgIds,
  onAllowAllChange,
  onToggleOrg,
  idPrefix,
}: {
  orgs: OrgOption[]
  allowAll: boolean
  selectedOrgIds: string[]
  onAllowAllChange: (v: boolean) => void
  onToggleOrg: (id: string) => void
  idPrefix: string
}) {
  return (
    <>
      <Field orientation="horizontal" className="items-center">
        <Checkbox
          checked={allowAll}
          onCheckedChange={(v) => onAllowAllChange(v === true)}
          id={`${idPrefix}-allowAll`}
        />
        <FieldLabel htmlFor={`${idPrefix}-allowAll`}>允许全部组织访问</FieldLabel>
      </Field>
      {!allowAll ? (
        <Field>
          <FieldLabel>绑定组织</FieldLabel>
          <div className="flex flex-col gap-2 rounded-lg border p-3">
            {orgs.length === 0 ? (
              <p className="text-sm text-muted-foreground">暂无组织</p>
            ) : (
              orgs.map((o) => (
                <label key={o.id} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={selectedOrgIds.includes(o.id)}
                    onCheckedChange={() => onToggleOrg(o.id)}
                  />
                  <span>
                    {o.name}{" "}
                    <span className="text-muted-foreground">({o.slug})</span>
                  </span>
                </label>
              ))
            )}
          </div>
        </Field>
      ) : null}
    </>
  )
}

export default function AdminAppsPage() {
  const [apps, setApps] = useState<AppRow[]>([])
  const [orgs, setOrgs] = useState<OrgOption[]>([])
  const [loading, setLoading] = useState(true)
  const [createOpen, setCreateOpen] = useState(false)
  const [editApp, setEditApp] = useState<AppRow | null>(null)
  const [pending, setPending] = useState(false)
  const [createdSecret, setCreatedSecret] = useState<{
    clientId: string
    clientSecret: string
  } | null>(null)

  const [confidential, setConfidential] = useState(true)
  const [createAllowAll, setCreateAllowAll] = useState(true)
  const [createOrgIds, setCreateOrgIds] = useState<string[]>([])

  const [editAllowAll, setEditAllowAll] = useState(true)
  const [editOrgIds, setEditOrgIds] = useState<string[]>([])

  /** Fetches and shapes the app + organization lists. Sets no state itself. */
  async function fetchAppsAndOrgs() {
    const [appsRes, orgsRes] = await Promise.all([
      fetch("/api/admin/apps"),
      fetch("/api/admin/organizations"),
    ])
    const appsData = await appsRes.json()
    const orgsData = await orgsRes.json()
    return {
      apps: (appsData.apps ?? []).map(
        (a: AppRow & { redirectUris: unknown }) => ({
          ...a,
          redirectUris: Array.isArray(a.redirectUris) ? a.redirectUris : [],
          organizations: a.organizations ?? [],
          allowAllOrganizations: !!a.allowAllOrganizations,
        })
      ) as AppRow[],
      orgs: (orgsData.organizations ?? []).map(
        (o: { id: string; name: string; slug: string }) => ({
          id: o.id,
          name: o.name,
          slug: o.slug,
        })
      ) as OrgOption[],
    }
  }

  async function load() {
    // No synchronous setState before the first await (see the effect below).
    const { apps: nextApps, orgs: nextOrgs } = await fetchAppsAndOrgs()
    setApps(nextApps)
    setOrgs(nextOrgs)
    setLoading(false)
  }

  // State is written only from the async continuation, never synchronously in
  // the effect body (react-hooks/set-state-in-effect).
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const { apps: nextApps, orgs: nextOrgs } = await fetchAppsAndOrgs()
      if (cancelled) return
      setApps(nextApps)
      setOrgs(nextOrgs)
      setLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [])

  function openEdit(app: AppRow) {
    setEditApp(app)
    setEditAllowAll(app.allowAllOrganizations)
    setEditOrgIds(app.organizations.map((o) => o.id))
  }

  function toggleCreateOrg(id: string) {
    setCreateOrgIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    )
  }

  function toggleEditOrg(id: string) {
    setEditOrgIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    )
  }

  async function createApp(form: FormData) {
    if (!createAllowAll && createOrgIds.length === 0) {
      toast.error("请至少选择一个组织，或勾选全部组织")
      return
    }
    setPending(true)
    const uris = String(form.get("redirectUris") || "")
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean)

    const res = await fetch("/api/admin/apps", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: form.get("name"),
        redirectUris: uris,
        allowedScopes: form.get("allowedScopes") || "openid profile email",
        isConfidential: confidential,
        allowAllOrganizations: createAllowAll,
        organizationIds: createAllowAll ? [] : createOrgIds,
      }),
    })
    setPending(false)
    const data = await res.json()
    if (!res.ok) {
      toast.error(data.error || "创建失败")
      return
    }
    toast.success("应用已创建")
    setCreateOpen(false)
    setCreateAllowAll(true)
    setCreateOrgIds([])
    setConfidential(true)
    if (data.clientSecret) {
      setCreatedSecret({
        clientId: data.app.clientId,
        clientSecret: data.clientSecret,
      })
    }
    await load()
  }

  async function saveEdit(form: FormData) {
    if (!editApp) return
    if (!editAllowAll && editOrgIds.length === 0) {
      toast.error("请至少选择一个组织，或勾选全部组织")
      return
    }
    setPending(true)
    const uris = String(form.get("redirectUris") || "")
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean)

    const res = await fetch(`/api/admin/apps/${editApp.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: form.get("name"),
        redirectUris: uris,
        allowedScopes: form.get("allowedScopes") || "openid profile email",
        allowAllOrganizations: editAllowAll,
        organizationIds: editAllowAll ? [] : editOrgIds,
      }),
    })
    setPending(false)
    const data = await res.json()
    if (!res.ok) {
      toast.error(data.error || "保存失败")
      return
    }
    toast.success("应用已更新")
    setEditApp(null)
    await load()
  }

  async function toggleStatus(app: AppRow) {
    const res = await fetch(`/api/admin/apps/${app.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        status: app.status === "ACTIVE" ? "DISABLED" : "ACTIVE",
      }),
    })
    if (!res.ok) {
      toast.error("操作失败")
      return
    }
    toast.success("已更新")
    await load()
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">应用</h1>
          <p className="text-sm text-muted-foreground">
            OAuth Client，可绑定指定组织或全部组织
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <PlusIcon data-icon="inline-start" />
          注册应用
        </Button>
      </div>

      {createdSecret ? (
        <Alert>
          <AlertTitle>请立即保存 Client Secret</AlertTitle>
          <AlertDescription>
            <div className="mt-2 flex flex-col gap-1 break-all font-mono text-xs">
              <span>client_id: {createdSecret.clientId}</span>
              <span>client_secret: {createdSecret.clientSecret}</span>
            </div>
            <Button
              size="sm"
              variant="outline"
              className="mt-3"
              onClick={() => setCreatedSecret(null)}
            >
              我已保存
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}

      {loading ? (
        <Spinner />
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>名称</TableHead>
                <TableHead>Client ID</TableHead>
                <TableHead>组织范围</TableHead>
                <TableHead>状态</TableHead>
                <TableHead className="text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {apps.map((a) => (
                <TableRow key={a.id}>
                  <TableCell className="font-medium">{a.name}</TableCell>
                  <TableCell className="font-mono text-xs">{a.clientId}</TableCell>
                  <TableCell className="max-w-xs text-xs">
                    {a.allowAllOrganizations
                      ? "全部组织"
                      : a.organizations.map((o) => o.name).join("、") || "未绑定"}
                  </TableCell>
                  <TableCell>
                    <Badge variant={a.status === "ACTIVE" ? "default" : "outline"}>
                      {a.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      <Button size="sm" variant="outline" onClick={() => openEdit(a)}>
                        编辑
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => void toggleStatus(a)}
                      >
                        {a.status === "ACTIVE" ? "禁用" : "启用"}
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>注册应用</DialogTitle>
            <DialogDescription>
              Client Secret 仅在创建时展示一次；请选择可用组织范围
            </DialogDescription>
          </DialogHeader>
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault()
              void createApp(new FormData(e.currentTarget))
            }}
          >
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="create-name">应用名称</FieldLabel>
                <Input id="create-name" name="name" required />
              </Field>
              <Field>
                <FieldLabel htmlFor="create-redirectUris">
                  Redirect URIs（每行一个）
                </FieldLabel>
                <Textarea
                  id="create-redirectUris"
                  name="redirectUris"
                  required
                  rows={3}
                  placeholder="http://localhost:4000/callback"
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="create-scopes">Scopes</FieldLabel>
                <Input
                  id="create-scopes"
                  name="allowedScopes"
                  defaultValue="openid profile email"
                />
              </Field>
              <Field orientation="horizontal" className="items-center">
                <Checkbox
                  checked={confidential}
                  onCheckedChange={(v) => setConfidential(v === true)}
                  id="create-confidential"
                />
                <FieldLabel htmlFor="create-confidential">
                  机密客户端（需要 secret）
                </FieldLabel>
              </Field>
              <OrgPicker
                idPrefix="create"
                orgs={orgs}
                allowAll={createAllowAll}
                selectedOrgIds={createOrgIds}
                onAllowAllChange={setCreateAllowAll}
                onToggleOrg={toggleCreateOrg}
              />
            </FieldGroup>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>
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

      <Dialog open={!!editApp} onOpenChange={(v) => !v && setEditApp(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>编辑应用</DialogTitle>
            <DialogDescription>
              {editApp?.clientId}
              {" · "}可调整名称、回调地址与组织绑定
            </DialogDescription>
          </DialogHeader>
          {editApp ? (
            <form
              key={editApp.id}
              className="flex flex-col gap-4"
              onSubmit={(e) => {
                e.preventDefault()
                void saveEdit(new FormData(e.currentTarget))
              }}
            >
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="edit-name">应用名称</FieldLabel>
                  <Input
                    id="edit-name"
                    name="name"
                    required
                    defaultValue={editApp.name}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="edit-redirectUris">
                    Redirect URIs（每行一个）
                  </FieldLabel>
                  <Textarea
                    id="edit-redirectUris"
                    name="redirectUris"
                    required
                    rows={3}
                    defaultValue={editApp.redirectUris.join("\n")}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="edit-scopes">Scopes</FieldLabel>
                  <Input
                    id="edit-scopes"
                    name="allowedScopes"
                    defaultValue={editApp.allowedScopes}
                  />
                </Field>
                <OrgPicker
                  idPrefix="edit"
                  orgs={orgs}
                  allowAll={editAllowAll}
                  selectedOrgIds={editOrgIds}
                  onAllowAllChange={setEditAllowAll}
                  onToggleOrg={toggleEditOrg}
                />
              </FieldGroup>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setEditApp(null)}>
                  取消
                </Button>
                <Button type="submit" disabled={pending}>
                  {pending ? <Spinner data-icon="inline-start" /> : null}
                  保存
                </Button>
              </DialogFooter>
            </form>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  )
}
