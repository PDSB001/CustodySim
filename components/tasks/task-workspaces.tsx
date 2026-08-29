"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import Image from "next/image"
import { CheckCircle2, ClipboardCheck, Send, Star } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { z } from "zod"

import { compressTaskImage } from "@/lib/task-image-client"
import { requestApi } from "@/components/shared/api-client"
import { EmptyState } from "@/components/shared/empty-state"
import { PageHeader } from "@/components/shared/page-header"
import {
  LoadingBlock,
  QueryStateView,
} from "@/components/shared/query-state-view"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { DatePicker } from "@/components/ui/date-picker"
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

const TemplateField = z.object({
  name: z.string(),
  type: z.enum([
    "TEXT",
    "TEXTAREA",
    "NUMBER",
    "SELECT",
    "DATE",
    "COPYWRITE",
    "IMAGE",
  ]),
  required: z.boolean(),
  options: z.array(z.string()),
})
const TemplateSnapshot = z.object({
  name: z.string().optional(),
  content: z.string().nullable().optional(),
  fields: z.array(TemplateField).default([]),
})
const Task = z.object({
  id: z.string(),
  title: z.string(),
  supervisedName: z.string().nullable(),
  scheduleAt: z.string(),
  deadline: z.string(),
  status: z.string(),
  templateSnapshot: TemplateSnapshot,
  submissionId: z.string().nullable(),
  content: z.string().nullable(),
  data: z.record(z.string(), z.unknown()).nullable(),
  officialSealData: z.string().nullable(),
})
const Tasks = z.array(Task)

function dateText(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value))
}

function statusLabel(status: string) {
  return (
    {
      PENDING: "待完成",
      RETURNED: "已退回",
      SUBMITTED: "待审核",
      APPROVED: "已通过",
      EXPIRED: "已逾期",
      REJECTED: "未通过",
    }[status] ?? status
  )
}

function statusClass(status: string) {
  if (status === "APPROVED") return "bg-emerald-50 text-emerald-700"
  if (["RETURNED", "REJECTED", "EXPIRED"].includes(status))
    return "bg-amber-50 text-amber-700"
  return "bg-blue-50 text-blue-700"
}

function CopywriteField({
  field,
  value,
  onChange,
}: {
  field: z.infer<typeof TemplateField>
  value: string
  onChange: (value: string) => void
}) {
  const source = (field.options?.[0] ?? "").trim()
  const written = value ?? ""
  const [draft, setDraft] = useState(written)
  const composing = useRef(false)
  useEffect(() => setDraft(written), [written])
  const typedCount = written.length
  const exact = written.trim().length > 0 && written.trim() === source
  if (!source)
    return (
      <p className="text-sm text-red-500">
        此抄写字段缺少原文，请联系管理员配置。
      </p>
    )
  const chars = source.split("")
  const extra =
    written.length > source.length ? written.slice(source.length) : ""
  const mismatchCount =
    chars.reduce(
      (count, ch, i) => count + (written[i] && written[i] !== ch ? 1 : 0),
      0,
    ) + (extra ? 1 : 0)
  return (
    <div className="space-y-2">
      <Label>
        {field.required ? "* " : ""}
        {field.name}
      </Label>
      <div className="border-border/70 bg-muted/40 rounded-lg border p-3">
        <p className="text-muted-foreground mb-1.5 text-[11px] font-semibold tracking-[0.12em] uppercase">
          抄写原文
        </p>
        <p className="text-foreground text-sm leading-7 whitespace-pre-wrap">
          {source}
        </p>
      </div>
      <div className="border-border/70 rounded-lg border p-3">
        <p className="text-muted-foreground mb-1.5 text-[11px] font-semibold tracking-[0.12em] uppercase">
          对照抄写
        </p>
        <p className="min-h-[3.5rem] text-sm leading-7 whitespace-pre-wrap">
          {chars.map((ch, i) => {
            const typed = written[i] ?? ""
            return (
              <span
                key={i}
                className={
                  !typed
                    ? "text-muted-foreground/70"
                    : typed === ch
                      ? "text-emerald-600"
                      : "text-red-500 underline"
                }
              >
                {typed || ch}
              </span>
            )
          })}
          {extra && <span className="text-red-500 underline">{extra}</span>}
        </p>
        <Textarea
          value={draft}
          onCompositionStart={() => {
            composing.current = true
          }}
          onCompositionEnd={(event) => {
            composing.current = false
            onChange(event.currentTarget.value)
          }}
          onChange={(event) => {
            setDraft(event.target.value)
            if (!composing.current) onChange(event.target.value)
          }}
          onPaste={(event) => event.preventDefault()}
          placeholder="在此逐字抄写上方原文"
          className="mt-2 min-h-[96px]"
        />
      </div>
      <p className="text-xs">
        {typedCount === 0 ? (
          <span className="text-muted-foreground">请输入上方原文</span>
        ) : exact ? (
          <span className="text-emerald-600">✓ 抄写一致，可以提交</span>
        ) : (
          <span className="text-red-500">✗ 尚有 {mismatchCount} 处不一致</span>
        )}
      </p>
    </div>
  )
}

function TaskImageField({
  field,
  value,
  onChange,
}: {
  field: z.infer<typeof TemplateField>
  value: string
  onChange: (value: string) => void
}) {
  const [error, setError] = useState<string | null>(null)
  const [compressing, setCompressing] = useState(false)
  return (
    <div className="space-y-2">
      <Label>
        {field.required ? "* " : ""}
        {field.name}
      </Label>
      <Input
        type="file"
        accept="image/jpeg,image/png,image/webp"
        disabled={compressing}
        onChange={async (event) => {
          const file = event.target.files?.[0]
          event.target.value = ""
          if (!file) return
          setError(null)
          setCompressing(true)
          try {
            onChange(await compressTaskImage(file))
          } catch (uploadError) {
            setError(
              uploadError instanceof Error
                ? uploadError.message
                : "图片处理失败",
            )
          } finally {
            setCompressing(false)
          }
        }}
      />
      <p className="text-muted-foreground text-xs">
        支持 JPG、PNG、WebP；原图最大 5 MB，浏览器会压缩后以不超过 1 MB
        的图片写入任务记录。
      </p>
      {compressing ? (
        <p className="text-brand-700 text-xs">正在压缩图片…</p>
      ) : null}
      {error ? <p className="text-destructive text-xs">{error}</p> : null}
      {value ? (
        <div className="border-border/70 bg-muted/30 relative max-w-sm overflow-hidden rounded-lg border p-2">
          <Image
            src={value}
            alt={`${field.name}预览`}
            width={640}
            height={480}
            unoptimized
            className="max-h-64 w-full rounded object-contain"
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-2"
            onClick={() => onChange("")}
          >
            移除图片
          </Button>
        </div>
      ) : null}
    </div>
  )
}

function TaskPayloadForm({ task }: { task: z.infer<typeof Task> }) {
  const client = useQueryClient()
  const [data, setData] = useState<Record<string, unknown>>(task.data ?? {})
  const lastSavedData = useRef(JSON.stringify(task.data ?? {}))
  const [draftState, setDraftState] = useState<
    "idle" | "saving" | "saved" | "error"
  >(task.data && Object.keys(task.data).length ? "saved" : "idle")
  const copywriteIncomplete = task.templateSnapshot.fields.some((field) => {
    if (field.type !== "COPYWRITE") return false
    const source = (field.options?.[0] ?? "").trim()
    return !source || String(data[field.name] ?? "").trim() !== source
  })
  const submit = useMutation({
    mutationFn: () =>
      requestApi("/api/submissions", z.object({ id: z.string() }), {
        method: "POST",
        body: JSON.stringify({ taskId: task.id, data }),
      }),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["tasks"] })
      toast.success("任务已提交，等待审核")
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "提交失败"),
  })
  const saveDraft = useMutation({
    mutationFn: ({
      nextData,
    }: {
      nextData: Record<string, unknown>
      serialized: string
    }) =>
      requestApi("/api/submissions/draft", z.object({ id: z.string() }), {
        method: "POST",
        body: JSON.stringify({ taskId: task.id, data: nextData }),
      }),
    onSuccess: (_, variables) => {
      lastSavedData.current = variables.serialized
      setDraftState("saved")
    },
    onError: () => setDraftState("error"),
  })
  const serializedData = JSON.stringify(data)
  useEffect(() => {
    if (serializedData === lastSavedData.current) return
    // 首次打开一个空表单不建草稿；但已保存过草稿时，清空最后一项也要同步。
    if (!Object.keys(data).length && lastSavedData.current === "{}") return

    setDraftState("saving")
    const timer = window.setTimeout(() => {
      saveDraft.mutate({ nextData: data, serialized: serializedData })
    }, 800)
    return () => window.clearTimeout(timer)
  }, [data, saveDraft, serializedData])
  if (task.status !== "PENDING" && task.status !== "RETURNED")
    return (
      <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-500">
        当前状态：
        {task.status === "SUBMITTED"
          ? "已提交，等待审核"
          : task.status === "APPROVED"
            ? "已通过"
            : statusLabel(task.status)}
      </p>
    )
  if (!task.templateSnapshot.fields.length)
    return (
      <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
        此任务尚未绑定表单模板，请联系管理员完善规则。
      </p>
    )
  return (
    <div className="mt-5 space-y-4">
      <p aria-live="polite" className="text-muted-foreground text-xs">
        {draftState === "saving"
          ? "正在自动保存草稿…"
          : draftState === "saved"
            ? "草稿已自动保存"
            : draftState === "error"
              ? "草稿保存失败，将在下次编辑时重试"
              : "开始填写后将自动保存草稿"}
      </p>
      {task.templateSnapshot.content && (
        <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm leading-6 text-slate-600">
          {task.templateSnapshot.content}
        </p>
      )}
      {task.templateSnapshot.fields.map((field) =>
        field.type === "COPYWRITE" ? (
          <CopywriteField
            key={field.name}
            field={field}
            value={String(data[field.name] ?? "")}
            onChange={(value) =>
              setData((current) => ({ ...current, [field.name]: value }))
            }
          />
        ) : field.type === "IMAGE" ? (
          <TaskImageField
            key={field.name}
            field={field}
            value={String(data[field.name] ?? "")}
            onChange={(value) =>
              setData((current) => ({ ...current, [field.name]: value }))
            }
          />
        ) : (
          <div key={field.name} className="space-y-2">
            <Label>
              {field.required ? "* " : ""}
              {field.name}
            </Label>
            {field.type === "TEXTAREA" ? (
              <Textarea
                value={String(data[field.name] ?? "")}
                onChange={(event) =>
                  setData((current) => ({
                    ...current,
                    [field.name]: event.target.value,
                  }))
                }
              />
            ) : field.type === "SELECT" ? (
              <Select
                value={String(data[field.name] ?? "")}
                onValueChange={(value) =>
                  setData((current) => ({
                    ...current,
                    [field.name]: value === "__none__" ? "" : value,
                  }))
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="请选择" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">请选择</SelectItem>
                  {field.options.map((option) => (
                    <SelectItem key={option} value={option}>
                      {option}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : field.type === "DATE" ? (
              <DatePicker
                ariaLabel={field.name}
                value={String(data[field.name] ?? "")}
                onValueChange={(value) =>
                  setData((current) => ({ ...current, [field.name]: value }))
                }
              />
            ) : (
              <Input
                type={field.type === "NUMBER" ? "number" : "text"}
                value={String(data[field.name] ?? "")}
                onChange={(event) =>
                  setData((current) => ({
                    ...current,
                    [field.name]: event.target.value,
                  }))
                }
              />
            )}
          </div>
        ),
      )}
      <Button
        disabled={submit.isPending || copywriteIncomplete}
        onClick={() => submit.mutate()}
      >
        <Send />
        提交任务
      </Button>
    </div>
  )
}

export function SupervisedTasks() {
  const tasks = useQuery({
    queryKey: ["tasks"],
    queryFn: () => requestApi("/api/tasks", Tasks),
  })
  return (
    <div className="workspace-stack mx-auto max-w-5xl">
      <PageHeader
        eyebrow="个人服务"
        title="我的任务"
        description="按任务表单完成填写，并在截止时间前提交。"
      />
      <QueryStateView
        isLoading={tasks.isLoading}
        error={tasks.error}
        isEmpty={(tasks.data?.length ?? 0) === 0}
        onRetry={() => tasks.refetch()}
        loading={<LoadingBlock className="h-48" />}
        empty={
          <div className="surface-panel motion-item">
            <EmptyState
              icon={ClipboardCheck}
              title="当前没有待完成任务"
              description="新任务生成后会按截止时间显示在这里。"
            />
          </div>
        }
      >
        {tasks.data?.map((task) => (
          <Card key={task.id} className="motion-item">
            <CardHeader>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <CardTitle>{task.title}</CardTitle>
                  <p className="mt-2 text-xs text-slate-500">
                    截止：{dateText(task.deadline)}
                  </p>
                </div>
                <span
                  className={`rounded-full px-2.5 py-1 text-xs font-medium ${statusClass(task.status)}`}
                >
                  {statusLabel(task.status)}
                </span>
              </div>
            </CardHeader>
            <CardContent>
              <TaskPayloadForm task={task} />
              {task.officialSealData ? (
                <Image
                  src={task.officialSealData}
                  alt="任务办结印章"
                  width={80}
                  height={80}
                  unoptimized
                  className="mt-4 size-20 object-contain"
                />
              ) : null}
            </CardContent>
          </Card>
        ))}
      </QueryStateView>
    </div>
  )
}

export function SupervisorTasks() {
  const client = useQueryClient()
  const [comments, setComments] = useState<Record<string, string>>({})
  const [grades, setGrades] = useState<Record<string, string>>({})
  const tasks = useQuery({
    queryKey: ["tasks"],
    queryFn: () => requestApi("/api/tasks", Tasks),
  })
  const review = useMutation({
    mutationFn: ({
      submissionId,
      result,
    }: {
      submissionId: string
      result: "APPROVED" | "RETURNED"
    }) =>
      requestApi("/api/reviews", z.object({ id: z.string() }), {
        method: "POST",
        body: JSON.stringify({
          submissionId,
          result,
          grade: grades[submissionId] ? Number(grades[submissionId]) : null,
          comment: comments[submissionId] || null,
        }),
      }),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["tasks"] })
      toast.success("审核结果已提交")
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "审核失败"),
  })
  const pending =
    tasks.data?.filter((task) => task.status === "SUBMITTED") ?? []
  return (
    <div className="workspace-stack mx-auto max-w-5xl">
      <PageHeader
        eyebrow="监管执行"
        title="执行任务审核"
        description="仅展示监管范围内已提交、等待审核的任务。"
      />
      <QueryStateView
        isLoading={tasks.isLoading}
        error={tasks.error}
        isEmpty={!tasks.isLoading && pending.length === 0}
        onRetry={() => tasks.refetch()}
        loading={<LoadingBlock className="h-48" />}
        empty={
          <div className="surface-panel motion-item">
            <EmptyState
              icon={Star}
              title="暂无待审核任务"
              description="被监管者提交任务后，会进入这里等待审核。"
            />
          </div>
        }
      >
        {pending.map((task) => (
          <Card key={task.id} className="motion-item">
            <CardHeader>
              <CardTitle>
                {task.title} · {task.supervisedName ?? "被监管人"}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-3 rounded-lg bg-slate-50 p-3">
                {task.templateSnapshot.fields.map((field) => {
                  const value = task.data?.[field.name]
                  if (field.type === "COPYWRITE") {
                    const source = (field.options?.[0] ?? "").trim()
                    const written = String(value ?? "").trim()
                    const exact = written === source
                    return (
                      <div key={field.name}>
                        <p className="text-xs font-semibold text-slate-500">
                          {field.name}
                        </p>
                        <p className="mt-1 text-xs text-slate-400">
                          原文：{source}
                        </p>
                        <p className="mt-1 text-sm whitespace-pre-wrap text-slate-700">
                          {written || "（未填写）"}
                        </p>
                        <p className="mt-1 text-xs">
                          {written ? (
                            exact ? (
                              <span className="font-medium text-emerald-600">
                                ✓ 逐字一致
                              </span>
                            ) : (
                              <span className="font-medium text-amber-600">
                                ⚠ 抄写与原文不一致
                              </span>
                            )
                          ) : (
                            <span className="text-slate-400">未填写</span>
                          )}
                        </p>
                      </div>
                    )
                  }
                  if (field.type === "IMAGE") {
                    const image = typeof value === "string" ? value : ""
                    return (
                      <div key={field.name}>
                        <p className="text-xs font-semibold text-slate-500">
                          {field.name}
                        </p>
                        {image ? (
                          <Image
                            src={image}
                            alt={`${field.name}提交图片`}
                            width={640}
                            height={480}
                            unoptimized
                            className="mt-2 max-h-72 w-full max-w-md rounded border object-contain"
                          />
                        ) : (
                          <p className="mt-1 text-sm text-slate-400">
                            （未上传）
                          </p>
                        )}
                      </div>
                    )
                  }
                  return (
                    <div key={field.name}>
                      <p className="text-xs font-semibold text-slate-500">
                        {field.name}
                      </p>
                      <p className="mt-1 text-sm whitespace-pre-wrap text-slate-700">
                        {String(value ?? "") || "（未填写）"}
                      </p>
                    </div>
                  )
                })}
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>评分（可选）</Label>
                  <Input
                    type="number"
                    min="0"
                    max="100"
                    value={grades[task.submissionId ?? ""] ?? ""}
                    onChange={(event) =>
                      setGrades((current) => ({
                        ...current,
                        [task.submissionId ?? ""]: event.target.value,
                      }))
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label>审核评语</Label>
                  <Input
                    value={comments[task.submissionId ?? ""] ?? ""}
                    onChange={(event) =>
                      setComments((current) => ({
                        ...current,
                        [task.submissionId ?? ""]: event.target.value,
                      }))
                    }
                  />
                </div>
              </div>
              <div className="flex gap-2">
                <Button
                  disabled={!task.submissionId || review.isPending}
                  onClick={() =>
                    task.submissionId &&
                    review.mutate({
                      submissionId: task.submissionId,
                      result: "APPROVED",
                    })
                  }
                >
                  <CheckCircle2 />
                  通过
                </Button>
                <Button
                  variant="outline"
                  disabled={!task.submissionId || review.isPending}
                  onClick={() =>
                    task.submissionId &&
                    review.mutate({
                      submissionId: task.submissionId,
                      result: "RETURNED",
                    })
                  }
                >
                  退回修改
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </QueryStateView>
    </div>
  )
}
