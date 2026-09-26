"use client"

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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Spinner } from "@/components/ui/spinner"

type UserRow = {
  id: string
  username: string
  email: string
  displayName: string
  role: "ADMIN" | "USER"
  status: "ACTIVE" | "DISABLED"
  createdAt: string
}

export default function AdminUsersPage() {
  const [users, setUsers] = useState<UserRow[]>([])
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState(false)
  const [editUser, setEditUser] = useState<UserRow | null>(null)
  const [pending, setPending] = useState(false)

  async function load() {
    // No synchronous setState before the first await: setting state
    // synchronously during mount causes a cascading render.
    const res = await fetch("/api/admin/users")
    const data = await res.json()
    setUsers(data.users ?? [])
    setLoading(false)
  }

  // State is written only from the async continuation, never synchronously in
  // the effect body (react-hooks/set-state-in-effect). `cancelled` avoids a
  // state update after unmount.
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const res = await fetch("/api/admin/users")
      const data = await res.json()
      if (cancelled) return
      setUsers(data.users ?? [])
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

  async function createUser(form: FormData) {
    setPending(true)
    const res = await fetch("/api/admin/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: form.get("username"),
        email: form.get("email"),
        displayName: form.get("displayName"),
        password: form.get("password"),
        role: form.get("role") || "USER",
      }),
    })
    setPending(false)
    if (!res.ok) {
      const data = await res.json()
      toast.error(data.error || "创建失败")
      return
    }
    toast.success("用户已创建")
    setOpen(false)
    await refresh()
  }

  async function patchUser(id: string, body: Record<string, unknown>) {
    const res = await fetch(`/api/admin/users/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      toast.error("操作失败")
      return
    }
    toast.success("已更新")
    setEditUser(null)
    await refresh()
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">用户</h1>
          <p className="text-sm text-muted-foreground">管理 RUAN 账号</p>
        </div>
        <Button onClick={() => setOpen(true)}>
          <PlusIcon data-icon="inline-start" />
          新建用户
        </Button>
      </div>

      {loading ? (
        <Spinner />
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>用户名</TableHead>
                <TableHead>显示名</TableHead>
                <TableHead>邮箱</TableHead>
                <TableHead>角色</TableHead>
                <TableHead>状态</TableHead>
                <TableHead className="text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((u) => (
                <TableRow key={u.id}>
                  <TableCell className="font-medium">{u.username}</TableCell>
                  <TableCell>{u.displayName}</TableCell>
                  <TableCell>{u.email}</TableCell>
                  <TableCell>
                    <Badge variant="secondary">{u.role}</Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant={u.status === "ACTIVE" ? "default" : "outline"}>
                      {u.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setEditUser(u)}
                      >
                        编辑
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          void patchUser(u.id, {
                            status: u.status === "ACTIVE" ? "DISABLED" : "ACTIVE",
                          })
                        }
                      >
                        {u.status === "ACTIVE" ? "禁用" : "启用"}
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
            <DialogTitle>新建用户</DialogTitle>
            <DialogDescription>创建后即可登录 RUAN</DialogDescription>
          </DialogHeader>
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault()
              void createUser(new FormData(e.currentTarget))
            }}
          >
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="username">用户名</FieldLabel>
                <Input id="username" name="username" required />
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
                <Input id="password" name="password" type="password" required minLength={6} />
              </Field>
              <Field>
                <FieldLabel htmlFor="role">角色</FieldLabel>
                <select
                  id="role"
                  name="role"
                  className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm"
                  defaultValue="USER"
                >
                  <option value="USER">USER</option>
                  <option value="ADMIN">ADMIN</option>
                </select>
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

      <Dialog open={!!editUser} onOpenChange={(v) => !v && setEditUser(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>编辑用户</DialogTitle>
            <DialogDescription>{editUser?.username}</DialogDescription>
          </DialogHeader>
          {editUser ? (
            <form
              className="flex flex-col gap-4"
              onSubmit={(e) => {
                e.preventDefault()
                const form = new FormData(e.currentTarget)
                const password = String(form.get("password") || "")
                void patchUser(editUser.id, {
                  displayName: form.get("displayName"),
                  email: form.get("email"),
                  role: form.get("role"),
                  ...(password ? { password } : {}),
                })
              }}
            >
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="edit-displayName">显示名</FieldLabel>
                  <Input
                    id="edit-displayName"
                    name="displayName"
                    defaultValue={editUser.displayName}
                    required
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="edit-email">邮箱</FieldLabel>
                  <Input
                    id="edit-email"
                    name="email"
                    type="email"
                    defaultValue={editUser.email}
                    required
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="edit-role">角色</FieldLabel>
                  <select
                    id="edit-role"
                    name="role"
                    className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm"
                    defaultValue={editUser.role}
                  >
                    <option value="USER">USER</option>
                    <option value="ADMIN">ADMIN</option>
                  </select>
                </Field>
                <Field>
                  <FieldLabel htmlFor="edit-password">重置密码（可选）</FieldLabel>
                  <Input id="edit-password" name="password" type="password" minLength={6} />
                </Field>
              </FieldGroup>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setEditUser(null)}>
                  取消
                </Button>
                <Button type="submit">保存</Button>
              </DialogFooter>
            </form>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  )
}
