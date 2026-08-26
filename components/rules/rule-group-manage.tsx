"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { FolderKanban, Trash2 } from "lucide-react"
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
  scopes: z.array(z.object({ id: z.string() })),
})

export function RuleGroupManage() {
  const client = useQueryClient()
  const [name, setName] = useState("")
  const [remark, setRemark] = useState("")
  const groups = useQuery({
    queryKey: ["rule-groups"],
    queryFn: () => requestApi("/api/admin/rule-groups", z.array(RuleGroup)),
  })
  const create = useMutation({
    mutationFn: () =>
      requestApi("/api/admin/rule-groups", RuleGroup, {
        method: "POST",
        body: JSON.stringify({ name, remark: remark || null, scopes: [] }),
      }),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["rule-groups"] })
      setName("")
      setRemark("")
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
                  <td colSpan={3} className="p-0">
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