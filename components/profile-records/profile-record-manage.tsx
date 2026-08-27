"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Archive, BookOpenCheck, FileText, LockKeyhole, Trash2 } from "lucide-react"
import { useState } from "react"
import { z } from "zod"

import { requestApi, formatDate } from "@/components/shared/api-client"
import { EmptyState } from "@/components/shared/empty-state"
import { MetricCell } from "@/components/shared/metric-cell"
import { PageHeader } from "@/components/shared/page-header"
import { StatusPill, type StatusTone } from "@/components/shared/status-pill"
import { Card, CardContent } from "@/components/ui/card"
import { toast } from "@/components/ui/toast"
import {
  ProfileFieldSchema,
  ProfileRecordEditor,
} from "@/components/profile-records/profile-record-editor"

const FormSchema = z.object({
  id: z.string(),
  name: z.string(),
  content: z.string().nullable(),
  fields: z.array(ProfileFieldSchema),
})
const FormsSchema = z.array(FormSchema)
const ReviewSchema = z.object({
  id: z.string(),
  reviewerId: z.string(),
  result: z.string(),
  step: z.number(),
  comment: z.string().nullable(),
})
const FormSnapshotSchema = z.object({
  name: z.string().optional(),
  content: z.string().nullable().optional(),
  fields: z.array(ProfileFieldSchema).default([]),
})
const RecordSchema = z.object({
  id: z.string(),
  userId: z.string(),
  userName: z.string(),
  formId: z.string(),
  formName: z.string(),
  formContent: z.string().nullable(),
  formSnapshot: FormSnapshotSchema,
  data: z.record(z.string(), z.unknown()),
  photoData: z.string().nullable(),
  signatureMode: z.enum(["GENERATED", "HANDWRITTEN"]),
  signatureData: z.string().nullable(),
  officialSealData: z.string().nullable(),
  status: z.string(),
  code: z.string().nullable(),
  boxName: z.string().nullable(),
  submittedAt: z.string().nullable(),
  lockedAt: z.string().nullable(),
  updatedAt: z.string(),
  fields: z.array(ProfileFieldSchema),
  reviews: z.array(ReviewSchema),
})
const RecordsSchema = z.array(RecordSchema)

function statusLabel(status: string) {
  return (
    {
      DRAFT: "草稿",
      PENDING_REVIEW: "会签中",
      RETURNED: "已退回",
      LOCKED: "已归档",
    }[status] ?? status
  )
}

function statusTone(status: string): StatusTone {
  if (status === "LOCKED") return "success"
  if (status === "RETURNED") return "warning"
  if (status === "PENDING_REVIEW") return "pending"
  return "neutral"
}

function RecordMeta({ record }: { record: z.infer<typeof RecordSchema> }) {
  return (
    <div className="text-muted-foreground flex flex-wrap items-center gap-2 text-xs">
      <StatusPill tone={statusTone(record.status)}>
        {statusLabel(record.status)}
      </StatusPill>
      {record.code ? (
        <span className="text-brand-700 font-mono font-semibold">
          编号 {record.code}
        </span>
      ) : null}
      {record.boxName ? <span>档案盒：{record.boxName}</span> : null}
      <span>更新于 {formatDate(record.updatedAt)}</span>
    </div>
  )
}

export function MyProfileRecordManage() {
  const client = useQueryClient()
  const [selectedFormId, setSelectedFormId] = useState<string | null>(null)
  const forms = useQuery({
    queryKey: ["profile-forms", "mine"],
    queryFn: () => requestApi("/api/profile-forms", FormsSchema),
  })
  const records = useQuery({
    queryKey: ["profile-records"],
    queryFn: () => requestApi("/api/profile-records", RecordsSchema),
  })
  const selectedForm =
    forms.data?.find((form) => form.id === selectedFormId) ??
    forms.data?.[0] ??
    null
  const selectedRecord = selectedForm
    ? (records.data?.find((record) => record.formId === selectedForm.id) ??
      null)
    : null
  const refresh = () => {
    client.invalidateQueries({ queryKey: ["profile-records"] })
  }
  const archivedCount =
    records.data?.filter((record) => record.status === "LOCKED").length ?? 0
  const pendingCount =
    records.data?.filter((record) => record.status === "PENDING_REVIEW")
      .length ?? 0

  return (
    <div className="workspace-stack mx-auto max-w-5xl">
      <PageHeader
        eyebrow="个人服务"
        title="个人档案"
        description="以一册档案集中维护个人资料。各分卷按监管流程会签，全部通过后自动锁定并生成编号。"
      />
      <section className="metric-grid page-enter" aria-label="档案概览">
        <MetricCell
          label="档案分卷"
          value={forms.data?.length ?? 0}
          detail="按分卷集中维护"
          icon={BookOpenCheck}
          tone="brand"
        />
        <MetricCell
          label="会签中"
          value={pendingCount}
          detail="等待监管人处理"
          icon={FileText}
          tone="warning"
        />
        <MetricCell
          label="已归档"
          value={archivedCount}
          detail="已锁定并编号"
          icon={LockKeyhole}
          tone="success"
        />
      </section>
      {forms.data?.length === 0 ? (
        <div className="surface-panel">
          <EmptyState
            icon={Archive}
            title="暂无可填写档案"
            description="管理员创建并启用档案表单后，会显示在这里。"
          />
        </div>
      ) : null}
      {selectedForm ? (
        <Card className="page-enter overflow-hidden">
          <CardContent className="grid gap-0 p-0 lg:grid-cols-[15rem_minmax(0,1fr)]">
            <aside className="border-border/70 bg-muted/30 border-b p-3 lg:border-r lg:border-b-0">
              <p className="text-muted-foreground px-2 pb-2 text-[11px] font-semibold tracking-[0.12em] uppercase">
                档案分卷
              </p>
              <nav
                className="flex gap-1 overflow-x-auto lg:flex-col"
                aria-label="档案分卷"
              >
                {forms.data?.map((form, index) => {
                  const record = records.data?.find(
                    (item) => item.formId === form.id,
                  )
                  const active = selectedForm.id === form.id
                  return (
                    <button
                      key={form.id}
                      type="button"
                      aria-current={active ? "page" : undefined}
                      className={`flex min-w-40 items-center gap-2 rounded-lg px-3 py-2.5 text-left text-sm transition-colors lg:min-w-0 ${active ? "bg-brand-500/10 text-brand-800" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}
                      onClick={() => setSelectedFormId(form.id)}
                    >
                      <span className="text-muted-foreground/70 w-4 text-xs font-medium">
                        {String(index + 1).padStart(2, "0")}
                      </span>
                      <span className="min-w-0 flex-1 truncate font-medium">
                        {form.name}
                      </span>
                      {record?.status === "LOCKED" ? (
                        <LockKeyhole className="text-success size-3.5 shrink-0" />
                      ) : record ? (
                        <span
                          className={`size-2 shrink-0 rounded-full ${record.status === "RETURNED" ? "bg-warning" : record.status === "PENDING_REVIEW" ? "bg-pending" : "bg-muted-foreground/40"}`}
                        />
                      ) : null}
                    </button>
                  )
                })}
              </nav>
            </aside>
            <section className="min-w-0 p-5 sm:p-7">
              <div className="border-border/70 mb-6 flex flex-wrap items-start justify-between gap-3 border-b pb-5">
                <div className="min-w-0">
                  <p className="text-muted-foreground text-xs font-medium tracking-[0.08em] uppercase">
                    档案分卷
                  </p>
                  <h2 className="text-foreground mt-1 text-xl font-semibold tracking-tight">
                    {selectedRecord?.formSnapshot.name ?? selectedForm.name}
                  </h2>
                </div>
                {selectedRecord ? <RecordMeta record={selectedRecord} /> : null}
              </div>
              <ProfileRecordEditor
                form={
                  selectedRecord?.formSnapshot.fields.length
                    ? {
                        id: selectedForm.id,
                        name:
                          selectedRecord.formSnapshot.name ?? selectedForm.name,
                        content:
                          selectedRecord.formSnapshot.content ??
                          selectedForm.content,
                        fields: selectedRecord.formSnapshot.fields,
                      }
                    : selectedForm
                }
                record={selectedRecord}
                onSaved={refresh}
              />
            </section>
          </CardContent>
        </Card>
      ) : null}
    </div>
  )
}

export function ProfileRecordManage() {
  const client = useQueryClient()
  const records = useQuery({
    queryKey: ["profile-records", "admin"],
    queryFn: () => requestApi("/api/profile-records", RecordsSchema),
  })
  const remove = useMutation({
    mutationFn: (id: string) =>
      requestApi(`/api/admin/profile-records/${id}`, z.object({ id: z.string() }), {
        method: "DELETE",
      }),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["profile-records", "admin"] })
      toast.success("已删除归档档案")
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "删除归档档案失败"),
  })
  return (
    <div className="workspace-stack">
      <PageHeader
        eyebrow="档案管理"
        title="档案记录"
        description="集中查看档案填写、会签与归档状态。归档后的记录保留填写快照和会签痕迹。"
      />
      <Card>
        <CardContent className="overflow-x-auto p-0">
          <table className="w-full min-w-[780px] text-left text-sm">
            <thead className="bg-muted/40 text-muted-foreground text-[11px] font-semibold tracking-[0.08em] uppercase">
              <tr>
                <th className="px-5 py-3">人员</th>
                <th className="px-5 py-3">档案表单</th>
                <th className="px-5 py-3">状态</th>
                <th className="px-5 py-3">档案编号</th>
                <th className="px-5 py-3">更新时间</th>
                <th className="px-5 py-3 text-right">操作</th>
              </tr>
            </thead>
            <tbody className="divide-border/60 divide-y">
              {records.data?.map((record) => (
                <tr key={record.id} className="hover:bg-muted/30">
                  <td className="px-5 py-4 font-medium">{record.userName}</td>
                  <td className="text-muted-foreground px-5 py-4">
                    {record.formName}
                  </td>
                  <td className="px-5 py-4">
                    <StatusPill tone={statusTone(record.status)}>
                      {statusLabel(record.status)}
                    </StatusPill>
                  </td>
                  <td className="text-brand-700 px-5 py-4 font-mono text-xs">
                    {record.code ?? "—"}
                  </td>
                  <td className="text-muted-foreground px-5 py-4">
                    {formatDate(record.updatedAt)}
                  </td>
                  <td className="px-5 py-4 text-right">
                    {record.status === "LOCKED" ? (
                      <button
                        type="button"
                        aria-label={`删除归档档案：${record.userName} · ${record.formName}`}
                        title="删除归档档案"
                        className="text-muted-foreground hover:text-destructive inline-flex size-8 items-center justify-center rounded-md transition-colors"
                        disabled={remove.isPending}
                        onClick={() => {
                          if (!window.confirm(`确定删除“${record.userName} · ${record.formName}”这份已归档档案吗？删除后不可恢复。`)) return
                          remove.mutate(record.id)
                        }}
                      >
                        <Trash2 className="size-4" />
                      </button>
                    ) : (
                      <span className="text-muted-foreground/50">—</span>
                    )}
                  </td>
                </tr>
              ))}
              {records.data?.length === 0 ? (
                <tr>
                  <td colSpan={6} className="p-0">
                    <EmptyState
                      icon={Archive}
                      title="暂无档案记录"
                      description="被监管人保存档案草稿后，记录会显示在这里。"
                    />
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  )
}
