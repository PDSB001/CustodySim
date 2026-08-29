"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Dices, FilePenLine, Trash2 } from "lucide-react"
import { useState } from "react"
import { z } from "zod"

import { requestApi } from "@/components/shared/api-client"
import { EmptyState } from "@/components/shared/empty-state"
import { StatusPill } from "@/components/shared/status-pill"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
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

const Template = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.string(),
})
const Pool = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.string(),
  enabled: z.boolean(),
  templates: z.array(Template),
})
const DeleteResult = z.object({ id: z.string(), affectedRuleCount: z.number() })

const kindLabels: Record<string, string> = {
  REPORT: "汇报类",
  STUDY: "学习类",
  LABOR: "劳动类",
}

export function TaskPoolManage() {
  const client = useQueryClient()
  const [name, setName] = useState("")
  const [kind, setKind] = useState("REPORT")
  const [templateIds, setTemplateIds] = useState<string[]>([])
  const [editingId, setEditingId] = useState<string | null>(null)
  const templates = useQuery({
    queryKey: ["report-templates", "task-pool-options"],
    queryFn: () => requestApi("/api/admin/report-templates", z.array(Template)),
  })
  const pools = useQuery({
    queryKey: ["task-pools"],
    queryFn: () => requestApi("/api/admin/task-pools", z.array(Pool)),
  })
  const reset = () => {
    setName("")
    setKind("REPORT")
    setTemplateIds([])
    setEditingId(null)
  }
  const save = useMutation({
    mutationFn: () => {
      const payload = { name, kind, templateIds, enabled: true }
      return requestApi(
        editingId
          ? `/api/admin/task-pools/${editingId}`
          : "/api/admin/task-pools",
        Pool,
        { method: editingId ? "PUT" : "POST", body: JSON.stringify(payload) },
      )
    },
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["task-pools"] })
      reset()
      toast.success(editingId ? "随机任务池已更新" : "随机任务池已创建")
    },
    onError: (error) =>
      toast.error(
        error instanceof Error ? error.message : "保存随机任务池失败",
      ),
  })
  const remove = useMutation({
    mutationFn: (id: string) =>
      requestApi(`/api/admin/task-pools/${id}`, DeleteResult, {
        method: "DELETE",
      }),
    onSuccess: (result) => {
      client.invalidateQueries({ queryKey: ["task-pools"] })
      client.invalidateQueries({ queryKey: ["rules"] })
      toast.success(
        result.affectedRuleCount
          ? `任务池已删除，${result.affectedRuleCount} 条关联规则已停用`
          : "随机任务池已删除",
      )
    },
    onError: (error) =>
      toast.error(
        error instanceof Error ? error.message : "删除随机任务池失败",
      ),
  })
  const compatibleTemplates =
    templates.data?.filter((template) => template.kind === kind) ?? []

  return (
    <section className="space-y-4">
      <div className="flex items-end justify-between gap-4 px-1">
        <div>
          <p className="text-foreground text-sm font-semibold">
            每日随机任务池
          </p>
          <p className="text-muted-foreground mt-1 text-xs">
            把同类型模板放进任务池；每日规则会为每名人员稳定地抽取其中一项。
          </p>
        </div>
        <span className="bg-muted/60 text-muted-foreground rounded-full px-2.5 py-1 text-xs font-medium">
          {pools.data?.length ?? 0} 个
        </span>
      </div>
      <Card className="shadow-soft border-0">
        <CardContent className="grid gap-4 p-5 lg:grid-cols-[15rem_minmax(0,1fr)_auto] lg:items-end">
          <div className="space-y-2">
            <Label>任务池名称</Label>
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="例如：每日教育任务池"
            />
          </div>
          <div className="space-y-2">
            <Label>任务类型与模板</Label>
            <Select
              value={kind}
              onValueChange={(value) => {
                setKind(value)
                setTemplateIds([])
              }}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="REPORT">汇报类</SelectItem>
                <SelectItem value="STUDY">学习类</SelectItem>
                <SelectItem value="LABOR">劳动类</SelectItem>
              </SelectContent>
            </Select>
            <div className="border-border/70 bg-muted/25 mt-2 grid max-h-40 gap-2 overflow-y-auto rounded-xl border p-3 sm:grid-cols-2">
              {compatibleTemplates.map((template) => (
                <label
                  key={template.id}
                  className="text-muted-foreground flex items-center gap-2 text-sm"
                >
                  <Checkbox
                    checked={templateIds.includes(template.id)}
                    onCheckedChange={(checked) =>
                      setTemplateIds((current) =>
                        checked
                          ? [...current, template.id]
                          : current.filter((id) => id !== template.id),
                      )
                    }
                  />
                  <span className="truncate">{template.name}</span>
                </label>
              ))}
              {!compatibleTemplates.length ? (
                <p className="text-muted-foreground text-xs sm:col-span-2">
                  先创建同类型的任务模板。
                </p>
              ) : null}
            </div>
          </div>
          <div className="flex gap-2">
            {editingId ? (
              <Button variant="outline" onClick={reset}>
                取消
              </Button>
            ) : null}
            <Button
              variant="brand"
              disabled={!name || !templateIds.length || save.isPending}
              onClick={() => save.mutate()}
            >
              <Dices />
              {save.isPending
                ? "保存中…"
                : editingId
                  ? "保存任务池"
                  : "创建任务池"}
            </Button>
          </div>
        </CardContent>
      </Card>
      {pools.data?.length ? (
        <div className="grid gap-4 xl:grid-cols-2">
          {pools.data.map((pool) => (
            <Card key={pool.id} className="shadow-soft border-0">
              <CardContent className="p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-foreground truncate font-semibold">
                      {pool.name}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <StatusPill tone="brand">
                        {kindLabels[pool.kind] ?? pool.kind}
                      </StatusPill>
                      <span className="text-muted-foreground text-xs">
                        {pool.templates.length} 个候选模板
                      </span>
                    </div>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`编辑任务池：${pool.name}`}
                      onClick={() => {
                        setEditingId(pool.id)
                        setName(pool.name)
                        setKind(pool.kind)
                        setTemplateIds(
                          pool.templates.map((template) => template.id),
                        )
                      }}
                    >
                      <FilePenLine />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`删除任务池：${pool.name}`}
                      className="text-muted-foreground hover:text-destructive"
                      disabled={remove.isPending}
                      onClick={() => {
                        if (
                          window.confirm(
                            `确定删除“${pool.name}”吗？关联规则会同时停用。`,
                          )
                        )
                          remove.mutate(pool.id)
                      }}
                    >
                      <Trash2 />
                    </Button>
                  </div>
                </div>
                <p className="text-muted-foreground mt-4 text-sm leading-6">
                  {pool.templates.map((template) => template.name).join("、")}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : !pools.isLoading ? (
        <Card className="shadow-soft border-0">
          <CardContent className="p-0">
            <EmptyState
              icon={Dices}
              title="尚未创建随机任务池"
              description="先从上方选择同类型任务模板，再把任务池用于每日规则。"
            />
          </CardContent>
        </Card>
      ) : null}
    </section>
  )
}
