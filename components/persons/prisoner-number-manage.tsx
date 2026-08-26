"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Hash, PencilLine, Settings2, WandSparkles } from "lucide-react"
import Link from "next/link"
import { useState } from "react"
import { z } from "zod"

import { requestApi } from "@/components/shared/api-client"
import { EmptyState } from "@/components/shared/empty-state"
import { IconChip } from "@/components/shared/icon-chip"
import { PageHeader } from "@/components/shared/page-header"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { toast } from "@/components/ui/toast"

const NumberItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  prisonerNumber: z.string().nullable(),
  customNumber: z.string().nullable(),
  status: z.string(),
  createdAt: z.string(),
})
const NumbersSchema = z.array(NumberItemSchema)
const RuleSchema = z.object({
  generationMode: z.enum(["RANDOM", "SEQUENTIAL"]),
  prefix: z.string(),
  dateFormat: z.string(),
  randomLength: z.number(),
  minLength: z.number(),
})

export function PrisonerNumberManage() {
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState<z.infer<
    typeof NumberItemSchema
  > | null>(null)
  const [number, setNumber] = useState("")
  const [reason, setReason] = useState("")
  const numbers = useQuery({
    queryKey: ["prisoner-numbers"],
    queryFn: () => requestApi("/api/admin/prisoner-numbers", NumbersSchema),
  })
  const rule = useQuery({
    queryKey: ["numbering-rule"],
    queryFn: () => requestApi("/api/admin/numbering", RuleSchema),
  })
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["prisoner-numbers"] })
    queryClient.invalidateQueries({ queryKey: ["persons"] })
  }
  const assign = useMutation({
    mutationFn: (personId: string) =>
      requestApi("/api/admin/prisoner-numbers", NumberItemSchema, {
        method: "POST",
        body: JSON.stringify({ personId }),
      }),
    onSuccess: () => {
      refresh()
      toast.success("系统编号已按全局规则生成")
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "生成失败"),
  })
  const update = useMutation({
    mutationFn: () =>
      requestApi(
        `/api/admin/prisoner-numbers/${editing?.id}`,
        NumberItemSchema,
        {
          method: "PATCH",
          body: JSON.stringify({ number, reason: reason || undefined }),
        },
      ),
    onSuccess: () => {
      refresh()
      setEditing(null)
      setNumber("")
      setReason("")
      toast.success("人员编号已单独修改")
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "修改失败"),
  })
  const openEdit = (item: z.infer<typeof NumberItemSchema>) => {
    setEditing(item)
    setNumber(item.prisonerNumber ?? "")
    setReason("")
  }
  const modeLabel =
    rule.data?.generationMode === "SEQUENTIAL" ? "连续流水" : "安全随机"

  return (
    <div className="workspace-stack">
      <PageHeader
        eyebrow="基础资料"
        title="人员编号"
        description="自动生成使用全局编号规则；遇到特殊个案时可单独改号，并留下变更原因与审计记录。"
        action={
          <Button asChild variant="outline">
            <Link href="/configs">
              <Settings2 />
              配置生成规则
            </Link>
          </Button>
        }
      />

      <Card className="surface-panel--brand">
        <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
          <div className="flex items-center gap-3">
            <IconChip icon={WandSparkles} tone="brand" />
            <div>
              <p className="text-sm font-semibold text-foreground">
                当前全局策略：{modeLabel}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {rule.data?.generationMode === "SEQUENTIAL"
                  ? "按当前流水序号递增生成。"
                  : "使用安全随机字符生成，并自动避免重复。"}
              </p>
            </div>
          </div>
          <Button asChild size="sm" variant="ghost">
            <Link href="/configs">查看规则 →</Link>
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="overflow-x-auto p-0">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="bg-muted/40 text-[11px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
              <tr>
                <th className="px-5 py-3">人员</th>
                <th className="px-5 py-3">系统编号</th>
                <th className="px-5 py-3">自定义编号</th>
                <th className="px-5 py-3 text-right">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {numbers.data?.map((item) => (
                <tr key={item.id} className="hover:bg-muted/30">
                  <td className="px-5 py-4 font-medium text-foreground">
                    {item.name}
                  </td>
                  <td className="px-5 py-4">
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-500/10 px-2.5 py-1 font-mono text-xs font-medium text-brand-700">
                      {item.prisonerNumber ?? "待生成"}
                    </span>
                  </td>
                  <td className="px-5 py-4 text-muted-foreground">
                    {item.customNumber ?? "—"}
                  </td>
                  <td className="px-5 py-4 text-right">
                    <div className="flex justify-end gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={assign.isPending}
                        onClick={() => assign.mutate(item.id)}
                      >
                        <WandSparkles />
                        {item.prisonerNumber ? "按规则重生成" : "自动生成"}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => openEdit(item)}
                      >
                        <PencilLine />
                        单独修改
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
              {numbers.data?.length === 0 && (
                <tr>
                  <td colSpan={4} className="p-0">
                    <EmptyState
                      icon={Hash}
                      title="暂无可编号人员"
                      description="创建被监管人员后，可以在这里自动生成或单独调整系统编号。"
                    />
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Dialog
        open={Boolean(editing)}
        onOpenChange={(open) => {
          if (!open && !update.isPending) setEditing(null)
        }}
      >
        <DialogContent showCloseButton={!update.isPending}>
          <DialogHeader>
            <DialogTitle>单独修改人员编号</DialogTitle>
            <DialogDescription>
              {editing
                ? `为“${editing.name}”设置专属系统编号。该操作不会修改全局生成规则。`
                : ""}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-1">
            <div className="space-y-2">
              <Label>系统编号</Label>
              <Input
                value={number}
                onChange={(event) =>
                  setNumber(event.target.value.toUpperCase())
                }
                placeholder="请输入唯一编号"
              />
            </div>
            <div className="space-y-2">
              <Label>修改原因（可选）</Label>
              <Textarea
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder="例如：历史档案编号校正"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              disabled={update.isPending}
              variant="outline"
              onClick={() => setEditing(null)}
            >
              取消
            </Button>
            <Button
              variant="brand"
              disabled={!number.trim() || update.isPending}
              onClick={() => update.mutate()}
            >
              <PencilLine />
              {update.isPending ? "保存中…" : "确认修改"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}