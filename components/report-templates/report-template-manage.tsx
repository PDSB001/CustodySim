"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { FilePenLine, FileText, ListChecks, Plus, Trash2 } from "lucide-react"
import { useState } from "react"
import { z } from "zod"
import { requestApi } from "@/components/shared/api-client"
import { EmptyState } from "@/components/shared/empty-state"
import { PageHeader } from "@/components/shared/page-header"
import { StatusPill } from "@/components/shared/status-pill"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { toast } from "@/components/ui/toast"
import { TaskPoolManage } from "@/components/report-templates/task-pool-manage"

const Field = z.object({
  name: z.string(),
  type: z.string(),
  required: z.boolean(),
  options: z.array(z.string()),
})
const Template = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.string(),
  content: z.string().nullable(),
  fields: z.array(Field),
})
const DeleteResult = z.object({
  id: z.string(),
  unboundRuleCount: z.number(),
})

const templateKindLabels: Record<string, string> = {
  REPORT: "汇报类",
  STUDY: "学习类",
  LABOR: "劳动类",
}

const fieldTypeLabels: Record<string, string> = {
  TEXT: "单行文本",
  TEXTAREA: "长文本",
  NUMBER: "数字",
  DATE: "日期",
  SELECT: "下拉选项",
  COPYWRITE: "逐字抄写",
  IMAGE: "图片上传",
}

const electronicFenceTemplateName = "电子围栏越界说明"
const reportTemplatesQueryKey = ["report-templates", "manage"] as const

export function ReportTemplateManage() {
  const client = useQueryClient()
  const [name, setName] = useState("")
  const [kind, setKind] = useState("REPORT")
  const [content, setContent] = useState("")
  const [fields, setFields] = useState([
    { name: "", type: "TEXT", required: true, options: "" },
  ])
  const [editingTemplate, setEditingTemplate] = useState<z.infer<
    typeof Template
  > | null>(null)
  const [templatePendingDelete, setTemplatePendingDelete] = useState<z.infer<
    typeof Template
  > | null>(null)
  const isEditingElectronicFenceTemplate =
    editingTemplate?.name === electronicFenceTemplateName
  const templates = useQuery({
    queryKey: reportTemplatesQueryKey,
    queryFn: () => requestApi("/api/admin/report-templates", z.array(Template)),
  })
  const templatePayload = () => ({
    name,
    kind,
    content: content || null,
    fields: fields.map((field) => ({
      name: field.name,
      type: field.type,
      required: field.required,
      options:
        field.type === "COPYWRITE"
          ? [field.options.trim()]
          : field.options
              .split(",")
              .map((value) => value.trim())
              .filter(Boolean),
    })),
  })
  const resetEditor = () => {
    setName("")
    setKind("REPORT")
    setContent("")
    setFields([{ name: "", type: "TEXT", required: true, options: "" }])
    setEditingTemplate(null)
  }
  const create = useMutation({
    mutationFn: () =>
      requestApi("/api/admin/report-templates", Template, {
        method: "POST",
        body: JSON.stringify(templatePayload()),
      }),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["report-templates"] })
      resetEditor()
      toast.success("任务表单模板已创建")
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "创建失败"),
  })
  const update = useMutation({
    mutationFn: (id: string) =>
      requestApi(`/api/admin/report-templates/${id}`, Template, {
        method: "PUT",
        body: JSON.stringify(templatePayload()),
      }),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["report-templates"] })
      resetEditor()
      toast.success("任务表单模板已更新；后续新任务将使用新版模板")
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "更新失败"),
  })
  const remove = useMutation({
    mutationFn: (id: string) =>
      requestApi(`/api/admin/report-templates/${id}`, DeleteResult, {
        method: "DELETE",
      }),
    onSuccess: (result) => {
      client.invalidateQueries({ queryKey: ["report-templates"] })
      setTemplatePendingDelete(null)
      toast.success(
        result.unboundRuleCount
          ? `模板已删除，${result.unboundRuleCount} 条规则已解除模板绑定`
          : "任务表单模板已删除",
      )
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "删除失败"),
  })
  const updateField = (
    index: number,
    key: keyof (typeof fields)[number],
    value: string | boolean,
  ) =>
    setFields((current) =>
      current.map((field, itemIndex) =>
        itemIndex === index ? { ...field, [key]: value } : field,
      ),
    )
  return (
    <div className="workspace-stack">
      <PageHeader
        eyebrow="任务载荷"
        title="任务表单模板"
        description="设计被监管人实际填写的字段；电子围栏越界说明为系统模板，可编辑。任务生成后会保存模板快照，后续调整不会影响历史任务。"
      />
      <Card className="page-enter shadow-soft border-0">
        <CardContent className="space-y-5 p-5 sm:p-6">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label>模板名称</Label>
              <Input
                value={name}
                disabled={isEditingElectronicFenceTemplate}
                onChange={(event) => setName(event.target.value)}
                placeholder="例如：每日学习心得"
              />
            </div>
            <div className="space-y-2">
              <Label>任务类型</Label>
              <Select
                disabled={isEditingElectronicFenceTemplate}
                value={kind}
                onValueChange={setKind}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="选择任务类型" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="REPORT">汇报类</SelectItem>
                  <SelectItem value="STUDY">学习类</SelectItem>
                  <SelectItem value="LABOR">劳动类</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-2">
            <Label>填写说明</Label>
            <Textarea
              value={content}
              onChange={(event) => setContent(event.target.value)}
              placeholder="说明填写要求与注意事项"
            />
            {isEditingElectronicFenceTemplate ? (
              <p className="text-muted-foreground text-xs">
                系统模板名称和任务类型固定；可调整填写说明与表单字段。
              </p>
            ) : null}
          </div>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-foreground text-sm font-medium">表单字段</p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  setFields((current) => [
                    ...current,
                    { name: "", type: "TEXT", required: false, options: "" },
                  ])
                }
              >
                <Plus />
                添加字段
              </Button>
            </div>
            {fields.map((field, index) => (
              <div
                key={index}
                className="border-border/70 bg-muted/40 grid gap-3 rounded-xl border p-3 md:grid-cols-[minmax(0,1fr)_10rem_8rem_auto]"
              >
                <Input
                  value={field.name}
                  onChange={(event) =>
                    updateField(index, "name", event.target.value)
                  }
                  placeholder="字段名称，例如：学习收获"
                />
                <Select
                  value={field.type}
                  onValueChange={(value) => updateField(index, "type", value)}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="TEXT">单行文本</SelectItem>
                    <SelectItem value="TEXTAREA">长文本</SelectItem>
                    <SelectItem value="NUMBER">数字</SelectItem>
                    <SelectItem value="DATE">日期</SelectItem>
                    <SelectItem value="SELECT">下拉选项</SelectItem>
                    <SelectItem value="COPYWRITE">逐字抄写</SelectItem>
                    <SelectItem value="IMAGE">图片上传</SelectItem>
                  </SelectContent>
                </Select>
                <label className="text-muted-foreground flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={field.required}
                    onCheckedChange={(checked) =>
                      updateField(index, "required", Boolean(checked))
                    }
                  />
                  必填
                </label>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="text-muted-foreground hover:text-destructive"
                  disabled={fields.length === 1}
                  onClick={() =>
                    setFields((current) =>
                      current.filter((_, itemIndex) => itemIndex !== index),
                    )
                  }
                >
                  <Trash2 />
                </Button>
                {field.type === "SELECT" && (
                  <Input
                    className="md:col-span-3"
                    value={field.options}
                    onChange={(event) =>
                      updateField(index, "options", event.target.value)
                    }
                    placeholder="选项用逗号分隔，例如：已完成,进行中"
                  />
                )}
                {field.type === "COPYWRITE" && (
                  <div className="space-y-1.5 md:col-span-3">
                    <p className="text-muted-foreground text-xs">
                      抄写原文（被监管人需逐字一致地抄写以下内容）
                    </p>
                    <Textarea
                      className="min-h-[80px]"
                      value={field.options}
                      onChange={(event) =>
                        updateField(index, "options", event.target.value)
                      }
                      placeholder="输入需要被监管人逐字抄写的内容，例如：社会主义核心价值观——富强、民主、文明、和谐…"
                    />
                  </div>
                )}
              </div>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="brand"
              disabled={
                !name ||
                fields.some((field) => !field.name) ||
                create.isPending ||
                update.isPending
              }
              onClick={() =>
                editingTemplate
                  ? update.mutate(editingTemplate.id)
                  : create.mutate()
              }
            >
              {editingTemplate
                ? update.isPending
                  ? "保存中…"
                  : "保存模板修改"
                : create.isPending
                  ? "保存中…"
                  : "保存任务表单"}
            </Button>
            {editingTemplate ? (
              <Button variant="outline" onClick={resetEditor}>
                取消编辑
              </Button>
            ) : null}
          </div>
        </CardContent>
      </Card>
      <section className="space-y-4">
        <div className="flex items-end justify-between gap-4 px-1">
          <div>
            <p className="text-foreground text-sm font-semibold">已有模板</p>
            <p className="text-muted-foreground mt-1 text-xs">
              查看字段、填写说明和适用任务类型；删除后不会影响已生成任务。
            </p>
          </div>
          <span className="bg-muted/60 text-muted-foreground rounded-full px-2.5 py-1 text-xs font-medium">
            {templates.data?.length ?? 0} 个
          </span>
        </div>

        {templates.isError ? (
          <Card className="page-enter shadow-soft border-0">
            <CardContent className="text-muted-foreground flex items-center gap-3 p-5 text-sm">
              <span className="text-destructive">模板列表加载失败。</span>
              <Button
                size="sm"
                variant="outline"
                onClick={() => templates.refetch()}
              >
                重新加载
              </Button>
            </CardContent>
          </Card>
        ) : templates.data?.length ? (
          <div className="grid gap-4 xl:grid-cols-2">
            {templates.data.map((template) => {
              const isElectronicFenceTemplate =
                template.name === electronicFenceTemplateName
              const requiredCount = (template.fields ?? []).filter(
                (field) => field.required,
              ).length
              return (
                <Card
                  key={template.id}
                  className="page-enter shadow-soft border-0"
                >
                  <CardContent className="p-0">
                    <div className="flex items-start justify-between gap-4 px-5 pt-5 sm:px-6 sm:pt-6">
                      <div className="flex min-w-0 items-start gap-3">
                        <span className="bg-brand-500/10 text-brand-700 grid size-9 shrink-0 place-items-center rounded-md">
                          <FileText className="size-4" />
                        </span>
                        <div className="min-w-0">
                          <p className="font-display text-foreground truncate text-[0.95rem] font-semibold">
                            {template.name}
                          </p>
                          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                            <StatusPill tone="brand">
                              {templateKindLabels[template.kind] ??
                                template.kind}
                            </StatusPill>
                            <span className="text-muted-foreground">
                              {template.fields.length} 个字段 · {requiredCount}{" "}
                              个必填
                            </span>
                          </div>
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        <Button
                          aria-label={`编辑模板：${template.name}`}
                          className="text-muted-foreground hover:text-brand-700"
                          size="icon-sm"
                          variant="ghost"
                          onClick={() => {
                            setEditingTemplate(template)
                            setName(template.name)
                            setKind(template.kind)
                            setContent(template.content ?? "")
                            setFields(
                              template.fields.map((field) => ({
                                name: field.name,
                                type: field.type,
                                required: field.required,
                                options:
                                  field.type === "COPYWRITE"
                                    ? (field.options[0] ?? "")
                                    : field.options.join(", "),
                              })),
                            )
                          }}
                        >
                          <FilePenLine />
                        </Button>
                        <Button
                          aria-label={`删除模板：${template.name}`}
                          className="text-muted-foreground hover:text-destructive"
                          size="icon-sm"
                          variant="ghost"
                          disabled={isElectronicFenceTemplate}
                          title={
                            isElectronicFenceTemplate
                              ? "系统模板不可删除，可直接编辑"
                              : undefined
                          }
                          onClick={() => setTemplatePendingDelete(template)}
                        >
                          <Trash2 />
                        </Button>
                      </div>
                    </div>

                    <div className="border-border/60 mx-5 mt-5 border-y py-4 sm:mx-6">
                      <p className="text-muted-foreground text-xs font-semibold tracking-[0.12em] uppercase">
                        填写说明
                      </p>
                      <p className="text-muted-foreground mt-1.5 line-clamp-3 text-sm leading-6">
                        {template.content ||
                          "未填写具体说明。被监管人会根据下方字段完成任务内容。"}
                      </p>
                    </div>

                    <div className="px-5 py-4 sm:px-6">
                      <div className="text-muted-foreground mb-2 flex items-center gap-2 text-xs font-semibold">
                        <ListChecks className="size-3.5" />
                        字段设计
                      </div>
                      <div className="divide-border/60 border-border/60 bg-muted/40 divide-y rounded-xl border px-3">
                        {(template.fields ?? []).map((field, index) => (
                          <div
                            key={`${field.name}-${index}`}
                            className="flex items-center justify-between gap-3 py-3"
                          >
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="text-foreground font-medium">
                                  {field.name}
                                </span>
                                <span className="bg-card text-muted-foreground ring-border/70 rounded px-1.5 py-0.5 text-[11px] ring-1">
                                  {fieldTypeLabels[field.type] ?? field.type}
                                </span>
                                {field.required && (
                                  <StatusPill tone="danger">必填</StatusPill>
                                )}
                              </div>
                              {field.type === "SELECT" &&
                                field.options.length > 0 && (
                                  <p className="text-muted-foreground mt-1 truncate text-xs">
                                    选项：{field.options.join("、")}
                                  </p>
                                )}
                            </div>
                            <span className="font-numeric text-muted-foreground text-xs">
                              {String(index + 1).padStart(2, "0")}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )
            })}
          </div>
        ) : !templates.isLoading ? (
          <Card className="page-enter shadow-soft border-0">
            <CardContent className="p-0">
              <EmptyState
                icon={FileText}
                title="还没有任务表单"
                description="先创建一个可复用的表单模板，再把它关联到对应的任务规则。"
              />
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 xl:grid-cols-2">
            {[0, 1].map((index) => (
              <Card
                key={index}
                className="bg-muted/40 shadow-soft h-64 animate-pulse border-0"
              />
            ))}
          </div>
        )}
      </section>
      <TaskPoolManage />

      <Dialog
        open={Boolean(templatePendingDelete)}
        onOpenChange={(open) => {
          if (!open && !remove.isPending) setTemplatePendingDelete(null)
        }}
      >
        <DialogContent showCloseButton={!remove.isPending}>
          <DialogHeader>
            <DialogTitle>删除任务表单模板？</DialogTitle>
            <DialogDescription>
              {templatePendingDelete
                ? `“${templatePendingDelete.name}”将被永久删除。已生成任务保留模板快照；正在使用它的规则会自动解除关联。`
                : ""}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              disabled={remove.isPending}
              variant="outline"
              onClick={() => setTemplatePendingDelete(null)}
            >
              取消
            </Button>
            <Button
              disabled={!templatePendingDelete || remove.isPending}
              variant="destructive"
              onClick={() => {
                if (templatePendingDelete)
                  remove.mutate(templatePendingDelete.id)
              }}
            >
              <Trash2 />
              确认删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
