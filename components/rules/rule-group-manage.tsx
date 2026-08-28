"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { ChevronDown, FolderKanban, Plus, Trash2, X } from "lucide-react"
import { useState } from "react"
import { z } from "zod"
import { requestApi } from "@/components/shared/api-client"
import { EmptyState } from "@/components/shared/empty-state"
import { IconChip } from "@/components/shared/icon-chip"
import { PageHeader } from "@/components/shared/page-header"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { toast } from "@/components/ui/toast"

const RuleGroup = z.object({
  id: z.string(),
  name: z.string(),
  remark: z.string().nullable(),
  scopes: z.array(z.object({ id: z.string(), targetType: z.string(), targetId: z.string() })),
})
const Organization = z.object({ id: z.string(), name: z.string(), category: z.string().nullable() })
const User = z.object({ id: z.string(), name: z.string(), role: z.string(), status: z.string() })

export function RuleGroupManage() {
  const client = useQueryClient()
  const [name, setName] = useState("")
  const [remark, setRemark] = useState("")
  const [scopeKeys, setScopeKeys] = useState<string[]>([])
  const [scopeToAdd, setScopeToAdd] = useState("")
  const [scopePickerOpen, setScopePickerOpen] = useState(false)
  const groups = useQuery({
    queryKey: ["rule-groups"],
    queryFn: () => requestApi("/api/admin/rule-groups", z.array(RuleGroup)),
  })
  const organizations = useQuery({
    queryKey: ["organizations"],
    queryFn: () => requestApi("/api/admin/orgs", z.array(Organization)),
  })
  const users = useQuery({
    queryKey: ["users"],
    queryFn: () => requestApi("/api/admin/users", z.array(User)),
  })
  const create = useMutation({
    mutationFn: () =>
      requestApi("/api/admin/rule-groups", RuleGroup, {
        method: "POST",
        body: JSON.stringify({
          name,
          remark: remark || null,
          scopes: scopeKeys.map((key) => {
            const [targetType, targetId] = key.split(":")
            return { targetType, targetId }
          }),
        }),
      }),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["rule-groups"] })
      setName("")
      setRemark("")
      setScopeKeys([])
      setScopeToAdd("")
      toast.success("规则组已创建")
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "创建失败"),
  })
  const remove = useMutation({
    mutationFn: (id: string) =>
      requestApi(`/api/admin/rule-groups/${id}`, z.object({ id: z.string() }), {
        method: "DELETE",
      }),
    onSuccess: () => client.invalidateQueries({ queryKey: ["rule-groups"] }),
  })
  return (
    <div className="workspace-stack">
      <PageHeader
        eyebrow="监管规则"
        title="规则组"
        description="将同一管理范围内的任务规则归类，便于统一配置。"
      />
      <Card>
        <CardContent className="grid gap-5 p-5 md:grid-cols-[1fr_2fr_auto] md:items-end sm:p-6">
          <div className="space-y-2">
            <Label>规则组名称</Label>
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="例如：一监区日常任务"
            />
          </div>
          <div className="space-y-2 md:col-span-2">
            <Label>适用范围（可多选）</Label>
            <div className="space-y-2">
              {scopeKeys.map((key) => {
                const [, targetId] = key.split(":")
                const organization = organizations.data?.find((item) => item.id === targetId)
                const user = users.data?.find((item) => item.id === targetId)
                const label = organization ? `组织：${organization.name}` : `人员：${user?.name ?? targetId}`
                return (
                  <div key={key} className="border-input bg-muted/30 flex items-center justify-between rounded-md border px-3 py-2 text-sm">
                    <span>{label}</span>
                    <button type="button" className="text-muted-foreground hover:text-destructive" onClick={() => setScopeKeys((current) => current.filter((item) => item !== key))} aria-label={`删除${label}`}>
                      <X className="size-4" />
                    </button>
                  </div>
                )
              })}
              <div className="flex gap-2">
                <div className="relative min-w-0 flex-1">
                  <button type="button" onClick={() => setScopePickerOpen((open) => !open)} className="border-input bg-background text-muted-foreground flex h-10 w-full items-center justify-between rounded-md border px-3 text-left text-sm">
                    <span>{scopeToAdd ? (organizations.data?.find((item) => `ORG:${item.id}` === scopeToAdd)?.name ?? users.data?.find((item) => `USER:${item.id}` === scopeToAdd)?.name) : "选择组织或人员"}</span>
                    <ChevronDown className="size-4" />
                  </button>
                  {scopePickerOpen && <div className="border-input bg-background absolute z-10 mt-1 max-h-56 w-full overflow-auto rounded-md border p-1 shadow-lg">
                    {organizations.data?.map((organization) => { const key = `ORG:${organization.id}`; return <button type="button" key={key} disabled={scopeKeys.includes(key)} onClick={() => { setScopeToAdd(key); setScopePickerOpen(false) }} className="hover:bg-muted w-full rounded px-2 py-1.5 text-left text-sm disabled:cursor-not-allowed disabled:opacity-40">组织：{organization.name}</button> })}
                    {users.data?.filter((user) => user.role === "SUPERVISED" && user.status === "active").map((user) => { const key = `USER:${user.id}`; return <button type="button" key={key} disabled={scopeKeys.includes(key)} onClick={() => { setScopeToAdd(key); setScopePickerOpen(false) }} className="hover:bg-muted w-full rounded px-2 py-1.5 text-left text-sm disabled:cursor-not-allowed disabled:opacity-40">人员：{user.name}</button> })}
                  </div>}
                </div>
                <Button type="button" variant="outline" size="icon" disabled={!scopeToAdd} onClick={() => { setScopeKeys((current) => [...current, scopeToAdd]); setScopeToAdd("") }} aria-label="添加范围"><Plus className="size-4" /></Button>
              </div>
            </div>
            <p className="text-muted-foreground text-xs">
              不选择范围时，规则组不会自动下发任务；规则可单独指定人员。
            </p>
          </div>
          <div className="space-y-2">
            <Label>说明</Label>
            <Input
              value={remark}
              onChange={(event) => setRemark(event.target.value)}
              placeholder="可选"
            />
          </div>
          <Button
            variant="brand"
            disabled={!name || create.isPending}
            onClick={() => create.mutate()}
          >
            {create.isPending ? "创建中…" : "新建规则组"}
          </Button>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left text-[11px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
              <tr>
                <th className="px-5 py-3">名称</th>
                <th className="px-5 py-3">说明</th>
                <th className="px-5 py-3">范围</th>
                <th className="px-5 py-3 text-right">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {groups.data?.map((group) => (
                <tr key={group.id} className="group/row hover:bg-muted/30">
                  <td className="px-5 py-4">
                    <div className="flex items-center gap-2.5">
                      <IconChip
                        icon={FolderKanban}
                        size="sm"
                        className="group-hover/row:bg-brand-500/10 group-hover/row:text-brand-700"
                      />
                      <p className="font-medium text-foreground">{group.name}</p>
                    </div>
                  </td>
                  <td className="px-5 py-4 text-muted-foreground">
                    {group.remark ?? "—"}
                  </td>
                  <td className="px-5 py-4 text-muted-foreground">
                    {group.scopes.length ? `${group.scopes.length} 个范围` : "未设置"}
                  </td>
                  <td className="px-5 py-4 text-right">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="text-muted-foreground hover:text-destructive"
                      onClick={() => remove.mutate(group.id)}
                    >
                      <Trash2 />
                    </Button>
                  </td>
                </tr>
              ))}
              {groups.data?.length === 0 && (
                <tr>
                  <td colSpan={4} className="p-0">
                    <EmptyState
                      icon={FolderKanban}
                      title="还没有规则组"
                      description="创建规则组以统一管理同一范围内的人员和任务。"
                    />
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  )
}
