"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { FilePenLine, Plus, Save, Trash2 } from "lucide-react"
import { useState } from "react"
import { z } from "zod"

import { requestApi } from "@/components/shared/api-client"
import { EmptyState } from "@/components/shared/empty-state"
import { PageHeader } from "@/components/shared/page-header"
import { StatusPill } from "@/components/shared/status-pill"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
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
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { toast } from "@/components/ui/toast"

const FieldSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.enum(["TEXT", "TEXTAREA", "NUMBER", "SELECT", "DATE", "COPYWRITE"]),
  required: z.boolean(),
  options: z.array(z.string()),
})
const FormSchema = z.object({
  id: z.string(),
  name: z.string(),
  content: z.string().nullable(),
  targetType: z.string(),
  active: z.boolean(),
  fields: z.array(FieldSchema),
})
const FormsSchema = z.array(FormSchema)

type DraftField = {
  name: string
  type: z.infer<typeof FieldSchema>["type"]
  required: boolean
  options: string
}
type Draft = {
  name: string
  content: string
  active: boolean
  fields: DraftField[]
}

const blankDraft = (): Draft => ({
  name: "",
  content: "",
  active: true,
  fields: [{ name: "", type: "TEXT", required: true, options: "" }],
})

const fieldLabels: Record<DraftField["type"], string> = {
  TEXT: "单行文本",
  TEXTAREA: "长文本",
  NUMBER: "数字",
  SELECT: "下拉选项",
  DATE: "日期",
  COPYWRITE: "逐字抄写",
}

export function ProfileFormManage() {
  const client = useQueryClient()
  const forms = useQuery({
    queryKey: ["profile-forms", "admin"],
    queryFn: () => requestApi("/api/admin/profile-forms", FormsSchema),
  })
  const [editing, setEditing] = useState<z.infer<typeof FormSchema> | null>(
    null,
  )
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<Draft>(blankDraft)
  const close = () => {
    setOpen(false)
    setEditing(null)
    setDraft(blankDraft())
  }
  const save = useMutation({
    mutationFn: () => {
      const payload = {
        name: draft.name,
        content: draft.content || null,
        active: draft.active,
        targetType: "SUPERVISED",
        fields: draft.fields.map((field) => ({
          name: field.name,
          type: field.type,
          required: field.required,
          options:
            field.type === "COPYWRITE"
              ? [field.options.trim()]
              : field.options
                  .split(",")
                  .map((item) => item.trim())
                  .filter(Boolean),
        })),
      }
      return requestApi(
        editing
          ? `/api/admin/profile-forms/${editing.id}`
          : "/api/admin/profile-forms",
        FormSchema,
        { method: editing ? "PATCH" : "POST", body: JSON.stringify(payload) },
      )
    },
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["profile-forms"] })
      toast.success(editing ? "档案表单已更新" : "档案表单已创建")
      close()
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "保存失败"),
  })
  const remove = useMutation({
    mutationFn: (id: string) =>
      requestApi(
        `/api/admin/profile-forms/${id}`,
        z.object({ id: z.string() }),
        { method: "DELETE" },
      ),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["profile-forms"] })
      toast.success("档案表单已删除")
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "删除失败"),
  })
  const edit = (form: z.infer<typeof FormSchema>) => {
    setEditing(form)
    setDraft({
      name: form.name,
      content: form.content ?? "",
      active: form.active,
      fields: form.fields.map((field) => ({
        ...field,
        options: field.options.join(", "),
      })),
    })
    setOpen(true)
  }
  const updateField = (index: number, patch: Partial<DraftField>) =>
    setDraft((current) => ({
      ...current,
      fields: current.fields.map((field, fieldIndex) =>
        fieldIndex === index ? { ...field, ...patch } : field,
      ),
    }))

  return (
    <div className="workspace-stack">
      <PageHeader
        eyebrow="档案管理"
        title="档案表单"
        description="设计被监管人填写的档案字段。记录保存时会固化表单快照，之后调整不会覆盖历史档案。"
        action={
          <Button
            variant="brand"
            onClick={() => {
              setEditing(null)
              setDraft(blankDraft())
              setOpen(true)
            }}
          >
            <Plus />
            新建档案表单
          </Button>
        }
      />
      <div className="grid gap-3">
        {forms.data?.map((form) => (
          <Card key={form.id} className="surface-panel--interactive">
            <CardContent className="flex flex-wrap items-center justify-between gap-4 p-5">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <FilePenLine className="text-brand-700 size-4" />
                  <p className="font-semibold">{form.name}</p>
                  <StatusPill tone={form.active ? "success" : "neutral"}>
                    {form.active ? "已启用" : "已停用"}
                  </StatusPill>
                </div>
                <p className="text-muted-foreground mt-2 text-xs">
                  {form.fields.length} 个字段 · 面向被监管人填写
                </p>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => edit(form)}>
                  编辑
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="text-muted-foreground hover:text-destructive"
                  aria-label={`删除 ${form.name}`}
                    onClick={() =>
                      window.confirm(
                        `确定删除“${form.name}”吗？如果其中已有已归档档案，历史档案和会签记录也会一并永久删除，且不可恢复。`,
                      ) && remove.mutate(form.id)
                    }
                >
                  <Trash2 />
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
      {forms.data?.length === 0 ? (
        <div className="surface-panel">
          <EmptyState
            icon={FilePenLine}
            title="还没有档案表单"
            description="先创建一份入监登记表或其他需要会签的档案。"
          />
        </div>
      ) : null}
      <Dialog open={open} onOpenChange={(value) => !value && close()}>
        <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editing ? "编辑档案表单" : "新建档案表单"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-5 py-2">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>表单名称</Label>
                <Input
                  value={draft.name}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      name: event.target.value,
                    }))
                  }
                  placeholder="例如：入监登记表"
                />
              </div>
              <div className="border-border/70 flex items-center gap-3 rounded-lg border px-3 py-2.5">
                <Switch
                  id="profile-form-active"
                  checked={draft.active}
                  onCheckedChange={(active) =>
                    setDraft((current) => ({ ...current, active }))
                  }
                />
                <div className="min-w-0">
                  <Label
                    htmlFor="profile-form-active"
                    className="cursor-pointer"
                  >
                    启用表单
                  </Label>
                  <p className="text-muted-foreground mt-0.5 text-xs">
                    启用后被监管人可填写
                  </p>
                </div>
              </div>
            </div>
            <div className="space-y-2">
              <Label>填写说明</Label>
              <Textarea
                value={draft.content}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    content: event.target.value,
                  }))
                }
                placeholder="说明填写要求或用途（可选）"
              />
            </div>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold">表单字段</p>
                  <p className="text-muted-foreground mt-0.5 text-xs">
                    下拉选项以逗号分隔；逐字抄写字段填写原文。
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setDraft((current) => ({
                      ...current,
                      fields: [
                        ...current.fields,
                        {
                          name: "",
                          type: "TEXT",
                          required: false,
                          options: "",
                        },
                      ],
                    }))
                  }
                >
                  <Plus />
                  添加字段
                </Button>
              </div>
              {draft.fields.map((field, index) => (
                <div
                  key={index}
                  className="border-border/70 grid gap-2 rounded-lg border p-3 sm:grid-cols-[minmax(0,1fr)_9rem_minmax(0,1fr)_auto]"
                >
                  <Input
                    value={field.name}
                    placeholder="字段名称"
                    onChange={(event) =>
                      updateField(index, { name: event.target.value })
                    }
                  />
                  <Select
                    value={field.type}
                    onValueChange={(type) =>
                      updateField(index, { type: type as DraftField["type"] })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(fieldLabels).map(([value, label]) => (
                        <SelectItem key={value} value={value}>
                          {label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Input
                    value={field.options}
                    placeholder={
                      field.type === "COPYWRITE"
                        ? "抄写原文"
                        : field.type === "SELECT"
                          ? "选项，以逗号分隔"
                          : "选项（可选）"
                    }
                    onChange={(event) =>
                      updateField(index, { options: event.target.value })
                    }
                  />
                  <div className="flex items-center justify-end gap-2 sm:col-span-4">
                    <label className="text-muted-foreground flex items-center gap-2 text-xs">
                      <Switch
                        checked={field.required}
                        onCheckedChange={(required) =>
                          updateField(index, { required })
                        }
                      />
                      必填
                    </label>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      disabled={draft.fields.length === 1}
                      aria-label="删除字段"
                      onClick={() =>
                        setDraft((current) => ({
                          ...current,
                          fields: current.fields.filter(
                            (_, fieldIndex) => fieldIndex !== index,
                          ),
                        }))
                      }
                    >
                      <Trash2 />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={close}>
              取消
            </Button>
            <Button
              disabled={save.isPending || !draft.name.trim()}
              onClick={() => save.mutate()}
            >
              <Save />
              {save.isPending ? "保存中…" : "保存表单"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
