"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import Image from "next/image"
import { CheckCircle2, ClipboardCheck, FileText, Send, Star } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { z } from "zod"

import { requestApi } from "@/components/shared/api-client"
import { EmptyState } from "@/components/shared/empty-state"
import { ImageUploadField } from "@/components/shared/image-upload-field"
import { PageHeader } from "@/components/shared/page-header"
import {
  LoadingBlock,
  QueryStateView,
} from "@/components/shared/query-state-view"
import { TaskSubmissionContent } from "@/components/tasks/task-submission-content"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { DatePicker } from "@/components/ui/date-picker"
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
  reviewComment: z.string().nullable().optional(),
  reviewGrade: z.number().nullable().optional(),
  reviewedAt: z.string().nullable().optional(),
  autoReviewReason: z.string().nullable().optional(),
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
      PENDING: "待执行",
      RETURNED: "已退回",
      SUBMITTED: "待批阅",
      APPROVED: "已通过",
      EXPIRED: "已逾期",
      CANCELLED: "已取消",
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
      client.invalidateQueries({ queryKey: ["dashboard-summary"] })
      toast.success("任务已呈报，等待批阅")
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
          ? "已呈报，等待批阅"
          : task.status === "APPROVED"
            ? "已通过"
            : statusLabel(task.status)}
        {task.autoReviewReason && (
          <span className="mt-2 block">自动审核：{task.autoReviewReason}</span>
        )}
      </p>
    )
  if (!task.templateSnapshot.fields.length)
    return (
      <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
        本项任务的填写内容尚未配置，请联系管理处核对。
      </p>
    )
  return (
    <div className="mt-5 space-y-4">
      {task.status === "RETURNED" && task.reviewComment && (
        <p
          role="status"
          className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900"
        >
          批阅意见（退回补正）：{task.reviewComment}
        </p>
      )}
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
          <ImageUploadField
            key={field.name}
            label={field.name}
            required={field.required}
            value={data[field.name]}
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

/**
 * 已办结任务的只读详情。
 * 待执行 / 已退回的任务由 TaskPayloadForm 直接可编辑呈现，无需此入口；
 * 其余状态（已通过 / 未通过 / 已逾期 / 已取消）此前只显示一行状态文字，
 * 呈报内容无法回看，这里补上。
 */
function TaskDetailDialog({ task }: { task: z.infer<typeof Task> }) {
  const comment = task.reviewComment?.trim()
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="mt-3">
          <FileText className="size-3.5" />
          查看任务内容
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{task.title}</DialogTitle>
          <DialogDescription>
            {statusLabel(task.status)}
            {task.reviewedAt ? ` · 批阅于 ${dateText(task.reviewedAt)}` : ""}
          </DialogDescription>
        </DialogHeader>
        <TaskSubmissionContent
          fields={task.templateSnapshot.fields}
          data={task.data}
        />
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium">批阅结果</span>
            {typeof task.reviewGrade === "number" ? (
              <Badge variant="brand">评分 {task.reviewGrade}</Badge>
            ) : null}
          </div>
          <p className="text-muted-foreground text-sm whitespace-pre-wrap">
            {comment || "本次批阅未填写意见。"}
          </p>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export function SupervisedTasks() {
  const [filter, setFilter] = useState("pending")
  const tasks = useQuery({
    queryKey: ["tasks"],
    queryFn: () => requestApi("/api/tasks", Tasks),
  })
  const filters = [
    {
      id: "pending",
      label: "待执行",
      matches: (status: string) => ["PENDING", "RETURNED"].includes(status),
    },
    {
      id: "review",
      label: "待批阅",
      matches: (status: string) => status === "SUBMITTED",
    },
    {
      id: "history",
      label: "执行记录",
      matches: (status: string) =>
        !["PENDING", "RETURNED", "SUBMITTED"].includes(status),
    },
  ]
  const visibleTasks = [...(tasks.data ?? [])]
    .filter((task) =>
      filters.find((item) => item.id === filter)!.matches(task.status),
    )
    .sort((a, b) =>
      filter === "pending"
        ? Date.parse(a.deadline) - Date.parse(b.deadline)
        : Date.parse(b.deadline) - Date.parse(a.deadline),
    )
  return (
    <div className="workspace-stack mx-auto max-w-5xl">
      <PageHeader
        eyebrow="监室 · 每日执行"
        title="服刑任务"
        description="按时完成指定任务并呈报。退回的内容需按批阅意见修正后重新提交。"
      />
      <div aria-label="任务状态筛选" className="flex flex-wrap gap-2">
        {filters.map((item) => (
          <Button
            key={item.id}
            variant={filter === item.id ? "default" : "outline"}
            aria-pressed={filter === item.id}
            onClick={() => setFilter(item.id)}
          >
            {item.label}
            {tasks.data
              ? ` · ${tasks.data.filter((task) => item.matches(task.status)).length}`
              : ""}
          </Button>
        ))}
      </div>
      <QueryStateView
        isLoading={tasks.isLoading}
        error={tasks.error}
        isEmpty={visibleTasks.length === 0}
        onRetry={() => tasks.refetch()}
        loading={<LoadingBlock rows={4} />}
        empty={
          <div className="surface-panel motion-item">
            <EmptyState
              icon={ClipboardCheck}
              title={
                filter === "pending"
                  ? "当前没有待执行任务"
                  : filter === "review"
                    ? "暂无等待批阅的呈报"
                    : "暂无执行记录"
              }
              description={
                filter === "pending"
                  ? "新任务按截止时间排列，请继续留意点名和监所通知。"
                  : filter === "review"
                    ? "任务提交后会在这里等待监管员批阅。"
                    : "已办结、逾期或取消的任务会保留在这里。"
              }
            />
          </div>
        }
      >
        {visibleTasks.map((task) => (
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
              {task.submissionId &&
              task.status !== "PENDING" &&
              task.status !== "RETURNED" ? (
                <TaskDetailDialog task={task} />
              ) : null}
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
      client.invalidateQueries({ queryKey: ["dashboard-summary"] })
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
        title="呈报批阅"
        description="核对在押人员呈报的内容与凭据；通过或退回前，请写明必要的批阅意见。"
      />
      <QueryStateView
        isLoading={tasks.isLoading}
        error={tasks.error}
        isEmpty={!tasks.isLoading && pending.length === 0}
        onRetry={() => tasks.refetch()}
        loading={<LoadingBlock rows={4} />}
        empty={
          <div className="surface-panel motion-item">
            <EmptyState
              icon={Star}
              title="暂无待审核任务"
              description="在押人员呈报的任务将送至此处，核对内容后予以批阅。"
            />
          </div>
        }
      >
        {pending.map((task) => (
          <Card key={task.id} className="motion-item">
            <CardHeader>
              <CardTitle>
                {task.title} · {task.supervisedName ?? "在押人员"}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {task.autoReviewReason && (
                <p
                  role="status"
                  className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900"
                >
                  自动审核转人工：{task.autoReviewReason}
                </p>
              )}
              <TaskSubmissionContent
                fields={task.templateSnapshot.fields}
                data={task.data}
              />
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
