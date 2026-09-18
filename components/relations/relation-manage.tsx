"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Plus, Trash2, UsersRound, X } from "lucide-react"
import { useState } from "react"
import { z } from "zod"
import { requestApi } from "@/components/shared/api-client"
import { EmptyState } from "@/components/shared/empty-state"
import { IconChip } from "@/components/shared/icon-chip"
import { PageHeader } from "@/components/shared/page-header"
import { StatusPill } from "@/components/shared/status-pill"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
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

const Scope = z.object({
  id: z.string(),
  targetType: z.string(),
  targetId: z.string(),
})
const Relation = z.object({
  id: z.string(),
  name: z.string(),
  status: z.string(),
  supervisorScopes: z.array(Scope),
  supervisedScopes: z.array(Scope),
})
const User = z.object({ id: z.string(), name: z.string(), role: z.string() })

export function RelationManage() {
  const client = useQueryClient()
  const [name, setName] = useState("")
  const [supervisorIds, setSupervisorIds] = useState<string[]>([])
  const [supervisedIds, setSupervisedIds] = useState<string[]>([])
  const [supervisorToAdd, setSupervisorToAdd] = useState("")
  const [supervisedToAdd, setSupervisedToAdd] = useState("")
  const relations = useQuery({
    queryKey: ["relations"],
    queryFn: () => requestApi("/api/admin/relations", z.array(Relation)),
  })
  const users = useQuery({
    queryKey: ["admin-users", "relation-options"],
    queryFn: () => requestApi("/api/admin/users", z.array(User)),
  })
  const create = useMutation({
    mutationFn: () =>
      requestApi("/api/admin/relations", Relation, {
        method: "POST",
        body: JSON.stringify({
          name,
          supervisorScopes: supervisorIds.map((targetId) => ({
            targetType: "USER",
            targetId,
          })),
          supervisedScopes: supervisedIds.map((targetId) => ({
            targetType: "USER",
            targetId,
          })),
        }),
      }),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["relations"] })
      setName("")
      setSupervisorIds([])
      setSupervisedIds([])
      setSupervisorToAdd("")
      setSupervisedToAdd("")
      toast.success("监管关系已创建")
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "创建失败"),
  })
  const remove = useMutation({
    mutationFn: (id: string) =>
      requestApi(`/api/admin/relations/${id}`, z.object({ id: z.string() }), {
        method: "DELETE",
      }),
    onSuccess: () => client.invalidateQueries({ queryKey: ["relations"] }),
  })
  const supervisors =
    users.data?.filter((user) => user.role === "SUPERVISOR") ?? []
  const supervised =
    users.data?.filter((user) => user.role === "SUPERVISED") ?? []
  return (
    <div className="workspace-stack">
      <PageHeader
        eyebrow="监管关系"
        title="监管关系"
        description="定义监管员与在押人员的有效管理范围。"
      />
      <Card>
        <CardContent className="grid gap-5 p-5 sm:p-6 md:grid-cols-4 md:items-end">
          <div className="space-y-2">
            <Label>关系名称</Label>
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="例如：一监区日常监管"
            />
          </div>
          <div className="space-y-2">
            <Label>监管员（可多选）</Label>
            <div className="space-y-2">
              {supervisorIds.map((id) => (
                <div
                  key={id}
                  className="border-input bg-muted/30 flex items-center justify-between rounded-md border px-3 py-2 text-sm"
                >
                  <span>
                    {supervisors.find((user) => user.id === id)?.name ?? id}
                  </span>
                  <button
                    type="button"
                    className="text-muted-foreground hover:text-destructive"
                    onClick={() =>
                      setSupervisorIds((current) =>
                        current.filter((item) => item !== id),
                      )
                    }
                    aria-label="移除监管员"
                  >
                    <X className="size-4" />
                  </button>
                </div>
              ))}
              <div className="flex gap-2">
                <Select
                  value={supervisorToAdd}
                  onValueChange={setSupervisorToAdd}
                >
                  <SelectTrigger className="min-w-0 flex-1">
                    <SelectValue placeholder="选择监管员" />
                  </SelectTrigger>
                  <SelectContent>
                    {supervisors.map((user) => (
                      <SelectItem
                        key={user.id}
                        value={user.id}
                        disabled={supervisorIds.includes(user.id)}
                      >
                        {user.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  disabled={!supervisorToAdd}
                  onClick={() => {
                    setSupervisorIds((current) => [...current, supervisorToAdd])
                    setSupervisorToAdd("")
                  }}
                  aria-label="添加监管员"
                >
                  <Plus className="size-4" />
                </Button>
              </div>
            </div>
          </div>
          <div className="space-y-2">
            <Label>在押人员（可多选）</Label>
            <div className="space-y-2">
              {supervisedIds.map((id) => (
                <div
                  key={id}
                  className="border-input bg-muted/30 flex items-center justify-between rounded-md border px-3 py-2 text-sm"
                >
                  <span>
                    {supervised.find((user) => user.id === id)?.name ?? id}
                  </span>
                  <button
                    type="button"
                    className="text-muted-foreground hover:text-destructive"
                    onClick={() =>
                      setSupervisedIds((current) =>
                        current.filter((item) => item !== id),
                      )
                    }
                    aria-label="移除在押人员"
                  >
                    <X className="size-4" />
                  </button>
                </div>
              ))}
              <div className="flex gap-2">
                <Select
                  value={supervisedToAdd}
                  onValueChange={setSupervisedToAdd}
                >
                  <SelectTrigger className="min-w-0 flex-1">
                    <SelectValue placeholder="选择在押人员" />
                  </SelectTrigger>
                  <SelectContent>
                    {supervised.map((user) => (
                      <SelectItem
                        key={user.id}
                        value={user.id}
                        disabled={supervisedIds.includes(user.id)}
                      >
                        {user.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  disabled={!supervisedToAdd}
                  onClick={() => {
                    setSupervisedIds((current) => [...current, supervisedToAdd])
                    setSupervisedToAdd("")
                  }}
                  aria-label="添加在押人员"
                >
                  <Plus className="size-4" />
                </Button>
              </div>
            </div>
          </div>
          <Button
            variant="brand"
            disabled={
              !name ||
              !supervisorIds.length ||
              !supervisedIds.length ||
              create.isPending
            }
            onClick={() => create.mutate()}
          >
            创建关系
          </Button>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left text-[11px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
              <tr>
                <th className="px-5 py-3">关系名称</th>
                <th className="px-5 py-3">状态</th>
                <th className="px-5 py-3">监管范围</th>
                <th className="px-5 py-3 text-right">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {relations.data?.map((relation) => (
                <tr
                  key={relation.id}
                  className="group/row hover:bg-muted/30"
                >
                  <td className="px-5 py-4">
                    <div className="flex items-center gap-2.5">
                      <IconChip
                        icon={UsersRound}
                        size="sm"
                        className="group-hover/row:bg-brand-500/10 group-hover/row:text-brand-700"
                      />
                      <p className="font-medium text-foreground">
                        {relation.name}
                      </p>
                    </div>
                  </td>
                  <td className="px-5 py-4">
                    <StatusPill
                      tone={relation.status === "active" ? "success" : "neutral"}
                    >
                      {relation.status === "active" ? "有效" : "停用"}
                    </StatusPill>
                  </td>
                  <td className="px-5 py-4 text-muted-foreground">
                    {relation.supervisorScopes.length} 名监管方 ·{" "}
                    {relation.supervisedScopes.length} 名在押人员
                  </td>
                  <td className="px-5 py-4 text-right">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="text-muted-foreground hover:text-destructive"
                      onClick={() => remove.mutate(relation.id)}
                    >
                      <Trash2 />
                    </Button>
                  </td>
                </tr>
              ))}
              {relations.data?.length === 0 && (
                <tr>
                  <td colSpan={4} className="p-0">
                    <EmptyState
                      icon={UsersRound}
                      title="暂无监管关系"
                      description="先选择监管员与在押人员，建立第一条监管关系。"
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
