"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { KeyRound, Plus, UsersRound } from "lucide-react"
import { useState } from "react"
import { z } from "zod"

import { requestApi } from "@/components/shared/api-client"
import { EmptyState } from "@/components/shared/empty-state"
import { IconChip } from "@/components/shared/icon-chip"
import { PageHeader } from "@/components/shared/page-header"
import { StatusPill } from "@/components/shared/status-pill"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { toast } from "@/components/ui/toast"
import { ORGANIZATION_CATEGORIES } from "@/lib/constants"

const OrganizationSchema = z.object({
  id: z.string(),
  name: z.string(),
  category: z.enum(ORGANIZATION_CATEGORIES).nullable(),
})
const UserSchema = z.object({
  id: z.string(),
  username: z.string(),
  name: z.string(),
  role: z.string(),
  status: z.string(),
  mustChangePassword: z.boolean(),
  phone: z.string().nullable(),
  organizationId: z.string().nullable(),
  organizationName: z.string().nullable(),
  createdAt: z.string(),
})
const UsersSchema = z.array(UserSchema)

const ROLE_LABELS: Record<string, string> = {
  ADMIN: "管理员",
  SUPERVISOR: "监管人",
  SUPERVISED: "被监管人",
}

function roleBadgeTone(role: string): "brand" | "info" | "warning" {
  if (role === "ADMIN") return "brand"
  if (role === "SUPERVISOR") return "info"
  return "warning"
}

export function UserManage() {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({
    username: "",
    name: "",
    password: "",
    role: "SUPERVISED",
    organizationId: "",
    phone: "",
  })
  const users = useQuery({
    queryKey: ["users"],
    queryFn: () => requestApi("/api/admin/users", UsersSchema),
  })
  const organizations = useQuery({
    queryKey: ["organizations"],
    queryFn: () => requestApi("/api/admin/orgs", z.array(OrganizationSchema)),
  })
  const create = useMutation({
    mutationFn: () =>
      requestApi("/api/admin/users", UserSchema, {
        method: "POST",
        body: JSON.stringify({
          ...form,
          organizationId: form.organizationId || null,
          phone: form.phone || null,
        }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["users"] })
      setOpen(false)
      setForm({
        username: "",
        name: "",
        password: "",
        role: "SUPERVISED",
        organizationId: "",
        phone: "",
      })
      toast.success("用户已创建，首次登录需修改密码")
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "创建失败"),
  })
  const reset = useMutation({
    mutationFn: (id: string) =>
      requestApi(
        `/api/admin/users/${id}/reset-password`,
        z.object({ id: z.string() }),
        { method: "POST", body: JSON.stringify({ password: "admin123" }) },
      ),
    onSuccess: () => toast.success("密码已重置为 admin123"),
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "重置失败"),
  })
  const updateForm = (key: keyof typeof form, value: string) =>
    setForm((current) => ({ ...current, [key]: value }))
  const assignableOrganizations = organizations.data?.filter((organization) =>
    form.role === "SUPERVISOR"
      ? organization.category === "SUPERVISION_UNIT"
      : form.role === "SUPERVISED"
        ? organization.category === "ROOM"
        : true,
  )
  return (
    <div className="workspace-stack">
      <PageHeader
        eyebrow="账户与权限"
        title="账户管理"
        description="创建并维护管理员、监管人和被监管人账号。"
        action={
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button variant="brand">
                <Plus />
                新建账户
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>新建账户</DialogTitle>
              </DialogHeader>
              <div className="grid gap-5 py-2 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>姓名</Label>
                  <Input
                    value={form.name}
                    onChange={(event) => updateForm("name", event.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label>用户名</Label>
                  <Input
                    value={form.username}
                    onChange={(event) =>
                      updateForm("username", event.target.value)
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label>初始密码</Label>
                  <Input
                    type="password"
                    value={form.password}
                    onChange={(event) =>
                      updateForm("password", event.target.value)
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label>角色</Label>
                  <Select
                    value={form.role}
                    onValueChange={(value) => {
                      updateForm("role", value)
                      updateForm("organizationId", "")
                    }}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ADMIN">管理员</SelectItem>
                      <SelectItem value="SUPERVISOR">监管人</SelectItem>
                      <SelectItem value="SUPERVISED">被监管人</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2 sm:col-span-2">
                  <Label>归属组织</Label>
                  <Select
                    value={form.organizationId}
                    onValueChange={(value) =>
                      updateForm(
                        "organizationId",
                        value === "__none__" ? "" : value,
                      )
                    }
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue
                        placeholder={
                          form.role === "ADMIN" ? "暂不分配" : "请选择归属组织"
                        }
                      />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">
                        {form.role === "ADMIN" ? "暂不分配" : "请选择归属组织"}
                      </SelectItem>
                      {assignableOrganizations?.map((organization) => (
                        <SelectItem
                          key={organization.id}
                          value={organization.id}
                        >
                          {organization.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2 sm:col-span-2">
                  <Label>手机号码（可选）</Label>
                  <Input
                    value={form.phone}
                    onChange={(event) =>
                      updateForm("phone", event.target.value)
                    }
                  />
                </div>
                <Button
                  variant="brand"
                  className="sm:col-span-2"
                  disabled={
                    !form.name ||
                    !form.username ||
                    form.password.length < 8 ||
                    create.isPending
                  }
                  onClick={() => create.mutate()}
                >
                  {create.isPending ? "创建中…" : "创建账户"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        }
      />
      <Card>
        <CardContent className="overflow-x-auto p-0">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="bg-muted/40 text-xs text-muted-foreground">
              <tr>
                <th className="px-5 py-3 font-medium">账户</th>
                <th className="px-5 py-3 font-medium">角色</th>
                <th className="px-5 py-3 font-medium">组织</th>
                <th className="px-5 py-3 font-medium">状态</th>
                <th className="px-5 py-3 text-right font-medium">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {users.data?.map((user) => (
                <tr key={user.id} className="group/row hover:bg-muted/30">
                  <td className="px-5 py-4">
                    <div className="flex items-center gap-2.5">
                      <IconChip
                        icon={UsersRound}
                        size="sm"
                        tone="neutral"
                        className="group-hover/row:bg-brand-500/10 group-hover/row:text-brand-700"
                      />
                      <div>
                        <p className="font-medium text-foreground">
                          {user.name}
                        </p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          @{user.username}
                        </p>
                      </div>
                    </div>
                  </td>
                  <td className="px-5 py-4">
                    <Badge variant={roleBadgeTone(user.role)}>
                      {ROLE_LABELS[user.role] ?? user.role}
                    </Badge>
                  </td>
                  <td className="px-5 py-4 text-muted-foreground">
                    {user.organizationName ?? "未分配"}
                  </td>
                  <td className="px-5 py-4">
                    <StatusPill
                      tone={user.status === "active" ? "success" : "neutral"}
                    >
                      {user.status === "active" ? "正常" : "已停用"}
                    </StatusPill>
                  </td>
                  <td className="px-5 py-4 text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-muted-foreground hover:text-foreground"
                      disabled={reset.isPending}
                      onClick={() => {
                        if (
                          window.confirm(
                            `将 ${user.name} 的密码重置为 admin123？`,
                          )
                        )
                          reset.mutate(user.id)
                      }}
                    >
                      <KeyRound />
                      重置密码
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {users.data?.length === 0 ? (
            <EmptyState
              icon={UsersRound}
              title="还没有账户"
              description="新建第一个账户开启系统配置。"
            />
          ) : null}
        </CardContent>
      </Card>
    </div>
  )
}