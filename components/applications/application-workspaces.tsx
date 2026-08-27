"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import Image from "next/image"
import {
  CheckCircle2,
  FilePlus2,
  FileStack,
  RotateCcw,
  Send,
  XCircle,
} from "lucide-react"
import { useState } from "react"
import { z } from "zod"

import { formatDate, requestApi } from "@/components/shared/api-client"
import { EmptyState } from "@/components/shared/empty-state"
import { PageHeader } from "@/components/shared/page-header"
import { StatusPill } from "@/components/shared/status-pill"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { DateTimePicker } from "@/components/ui/date-picker"
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
import { formatIso, resolvePeriod } from "@/lib/shanghai-datetime"

const ApplicationType = z.enum([
  "LEAVE",
  "TEMPORARY_OUT_OF_CUSTODY",
  "SENTENCE_REDUCTION",
  "GENERAL",
])
const ApplicationSchema = z.object({
  id: z.string(),
  type: ApplicationType,
  title: z.string(),
  reason: z.string(),
  payload: z.record(z.string(), z.unknown()),
  archiveRecordId: z.string().nullable(),
  archiveSnapshot: z.record(z.string(), z.unknown()).nullable(),
  officialSealData: z.string().nullable(),
  status: z.string(),
  submittedAt: z.string().nullable(),
  decidedAt: z.string().nullable(),
  createdAt: z.string(),
  reviews: z.array(
    z.object({ result: z.string(), comment: z.string().nullable() }),
  ),
})
const ApplicationsSchema = z.array(ApplicationSchema)
const ArchiveSchema = z.object({
  id: z.string(),
  code: z.string().nullable(),
  formName: z.string(),
  lockedAt: z.string().nullable(),
})
const ArchivesSchema = z.array(ArchiveSchema)
const ReviewSchema = z.object({
  id: z.string(),
  applicationId: z.string(),
  step: z.number(),
  result: z.string(),
  userName: z.string(),
  type: ApplicationType,
  title: z.string(),
  reason: z.string(),
  payload: z.record(z.string(), z.unknown()),
  archiveSnapshot: z.record(z.string(), z.unknown()).nullable(),
  officialSealData: z.string().nullable(),
  status: z.string(),
  submittedAt: z.string().nullable(),
})
const ReviewsSchema = z.array(ReviewSchema)

function statusLabel(status: string) {
  return (
    {
      PENDING_REVIEW: "审核中",
      APPROVED: "已批准",
      RETURNED: "已退回",
      REJECTED: "已驳回",
      DRAFT: "草稿",
    }[status] ?? status
  )
}
function statusTone(status: string) {
  if (status === "APPROVED") return "success" as const
  if (status === "RETURNED" || status === "REJECTED") return "warning" as const
  return "pending" as const
}

export function MyApplications() {
  const client = useQueryClient()
  const [type, setType] = useState<z.infer<typeof ApplicationType>>("LEAVE")
  const [reason, setReason] = useState("")
  const [leaveStartAt, setLeaveStartAt] = useState("")
  const [leaveEndAt, setLeaveEndAt] = useState("")
  const [temporaryReleaseStartAt, setTemporaryReleaseStartAt] = useState("")
  const [temporaryReleaseEndAt, setTemporaryReleaseEndAt] = useState("")
  const [archiveRecordId, setArchiveRecordId] = useState("")
  const applications = useQuery({
    queryKey: ["applications"],
    queryFn: () => requestApi("/api/applications", ApplicationsSchema),
  })
  const archives = useQuery({
    queryKey: ["application-archives"],
    queryFn: () => requestApi("/api/applications/archives", ArchivesSchema),
  })
  const create = useMutation({
    mutationFn: () =>
      requestApi("/api/applications", z.object({ id: z.string() }), {
        method: "POST",
        body: JSON.stringify({
          type,
          reason,
          leaveStartAt: leaveStartAt || null,
          leaveEndAt: leaveEndAt || null,
          temporaryReleaseStartAt: temporaryReleaseStartAt || null,
          temporaryReleaseEndAt: temporaryReleaseEndAt || null,
          archiveRecordId: archiveRecordId || null,
        }),
      }),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["applications"] })
      setReason("")
      setLeaveStartAt("")
      setLeaveEndAt("")
      setTemporaryReleaseStartAt("")
      setTemporaryReleaseEndAt("")
      setArchiveRecordId("")
      toast.success("申请已提交审核")
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "提交失败"),
  })
  return (
    <div className="workspace-stack mx-auto max-w-5xl">
      <PageHeader
        eyebrow="个人服务"
        title="我的申请"
        description="申请会按监管关系逐级流转至管理处。请假 / 临时离监按起止时刻生效，跨日/精确到分钟均支持。"
      />
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FilePlus2 className="size-4" />
            发起申请
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="application-type">申请类型</Label>
            <Select
              value={type}
              onValueChange={(value) =>
                setType(value as z.infer<typeof ApplicationType>)
              }
            >
              <SelectTrigger id="application-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="LEAVE">请假申请</SelectItem>
                <SelectItem value="TEMPORARY_OUT_OF_CUSTODY">
                  临时离监申请
                </SelectItem>
                <SelectItem value="SENTENCE_REDUCTION">减刑申请</SelectItem>
                <SelectItem value="GENERAL">一般事项申请</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {type === "LEAVE" ? (
            <>
              <div className="space-y-2">
                <Label>请假开始时间</Label>
                <DateTimePicker
                  ariaLabel="请假开始时间"
                  value={leaveStartAt}
                  onValueChange={setLeaveStartAt}
                />
              </div>
              <div className="space-y-2">
                <Label>请假结束时间</Label>
                <DateTimePicker
                  ariaLabel="请假结束时间"
                  value={leaveEndAt}
                  onValueChange={setLeaveEndAt}
                />
              </div>
            </>
          ) : null}
          {type === "TEMPORARY_OUT_OF_CUSTODY" ? (
            <>
              <div className="space-y-2">
                <Label>离监开始时间</Label>
                <DateTimePicker
                  ariaLabel="离监开始时间"
                  value={temporaryReleaseStartAt}
                  onValueChange={setTemporaryReleaseStartAt}
                />
              </div>
              <div className="space-y-2">
                <Label>离监结束时间</Label>
                <DateTimePicker
                  ariaLabel="离监结束时间"
                  value={temporaryReleaseEndAt}
                  onValueChange={setTemporaryReleaseEndAt}
                />
              </div>
              <p className="text-muted-foreground text-xs sm:col-span-2">
                管理处最终批准后，仅在起止时间窗口内显示为离监，并停止电子围栏判定。
              </p>
            </>
          ) : null}
          {type === "SENTENCE_REDUCTION" ? (
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="application-archive-record">关联已归档档案</Label>
              <Select
                value={archiveRecordId}
                onValueChange={setArchiveRecordId}
              >
                <SelectTrigger id="application-archive-record">
                  <SelectValue placeholder="请选择作为减刑依据的档案" />
                </SelectTrigger>
                <SelectContent>
                  {archives.data?.map((record) => (
                    <SelectItem key={record.id} value={record.id}>
                      {record.formName} · {record.code ?? "未编号"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-muted-foreground text-xs">
                提交时会保存该归档档案的快照，后续档案调整不会改变申请依据。
              </p>
            </div>
          ) : null}
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="application-reason">申请事由</Label>
            <Textarea
              id="application-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="请说明申请事由和必要情况"
            />
          </div>
          <div className="sm:col-span-2">
            <Button
              disabled={create.isPending || !reason.trim()}
              onClick={() => create.mutate()}
            >
              <Send />
              提交申请
            </Button>
          </div>
        </CardContent>
      </Card>
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">申请记录</h2>
        {applications.data?.map((application) => {
          const payload = (application.payload ?? {}) as Record<string, unknown>
          const leave =
            application.type === "LEAVE"
              ? resolvePeriod(
                  payload,
                  "leaveStartAt",
                  "leaveEndAt",
                  "leaveStartDate",
                  "leaveEndDate",
                )
              : null
          const temporary =
            application.type === "TEMPORARY_OUT_OF_CUSTODY"
              ? resolvePeriod(
                  payload,
                  "temporaryReleaseStartAt",
                  "temporaryReleaseEndAt",
                  "temporaryReleaseStartDate",
                  "temporaryReleaseEndDate",
                )
              : null
          const period = leave ?? temporary
          const rangeText = period
            ? `${formatIso(new Date(period.startMs).toISOString())} 至 ${formatIso(new Date(period.endMs).toISOString())}`
            : null
          return (
            <Card key={application.id}>
              <CardContent className="flex flex-wrap items-start justify-between gap-4 p-5">
                <div>
                  <div className="flex items-center gap-2">
                    <p className="font-semibold">{application.title}</p>
                    <StatusPill tone={statusTone(application.status)}>
                      {statusLabel(application.status)}
                    </StatusPill>
                  </div>
                  <p className="text-muted-foreground mt-2 max-w-2xl text-sm leading-6">
                    {application.reason}
                  </p>
                  {rangeText ? (
                    <p className="text-muted-foreground mt-2 text-xs">
                      {application.type === "LEAVE" ? "请假时间" : "离监时间"}：
                      {rangeText}
                    </p>
                  ) : null}
                  {application.archiveSnapshot ? (
                    <p className="text-muted-foreground mt-2 text-xs">
                      已关联档案：
                      {String(application.archiveSnapshot.formName ?? "档案")}
                      {application.archiveSnapshot.code
                        ? ` · ${String(application.archiveSnapshot.code)}`
                        : ""}
                    </p>
                  ) : null}
                  {application.officialSealData ? (
                    <Image
                      src={application.officialSealData}
                      alt="申请审批印章"
                      width={80}
                      height={80}
                      unoptimized
                      className="mt-3 size-20 object-contain"
                    />
                  ) : null}
                </div>
                <p className="text-muted-foreground text-xs">
                  提交于{" "}
                  {formatDate(application.submittedAt ?? application.createdAt)}
                </p>
              </CardContent>
            </Card>
          )
        })}
      </section>
      {applications.data?.length === 0 ? (
        <EmptyState
          icon={FileStack}
          title="暂无申请记录"
          description="在上方选择类型并提交第一份申请。"
        />
      ) : null}
    </div>
  )
}

export function ApplicationReviews() {
  const client = useQueryClient()
  const [comments, setComments] = useState<Record<string, string>>({})
  const reviews = useQuery({
    queryKey: ["application-reviews"],
    queryFn: () => requestApi("/api/application-reviews", ReviewsSchema),
  })
  const action = useMutation({
    mutationFn: ({
      id,
      result,
    }: {
      id: string
      result: "APPROVED" | "RETURNED" | "REJECTED"
    }) =>
      requestApi(
        `/api/application-reviews/${id}`,
        z.object({ id: z.string() }),
        {
          method: "PATCH",
          body: JSON.stringify({ result, comment: comments[id] || null }),
        },
      ),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["application-reviews"] })
      toast.success("申请已处理")
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "处理失败"),
  })
  const pending =
    reviews.data?.filter((review) => review.result === "PENDING") ?? []
  const renderRange = (review: z.infer<typeof ReviewsSchema>[number]) => {
    const payload = (review.payload ?? {}) as Record<string, unknown>
    const period =
      review.type === "LEAVE"
        ? resolvePeriod(
            payload,
            "leaveStartAt",
            "leaveEndAt",
            "leaveStartDate",
            "leaveEndDate",
          )
        : review.type === "TEMPORARY_OUT_OF_CUSTODY"
          ? resolvePeriod(
              payload,
              "temporaryReleaseStartAt",
              "temporaryReleaseEndAt",
              "temporaryReleaseStartDate",
              "temporaryReleaseEndDate",
            )
          : null
    if (!period) return null
    return `${formatIso(new Date(period.startMs).toISOString())} 至 ${formatIso(new Date(period.endMs).toISOString())}`
  }
  return (
    <div className="workspace-stack mx-auto max-w-5xl">
      <PageHeader
        eyebrow="监管执行"
        title="申请审核"
        description="请假获批后切换为请假状态；临时离监仅在获批有效期内切换为离监，并暂停围栏判定。"
      />
      {pending.map((review) => {
        const range = renderRange(review)
        return (
          <Card key={review.id}>
            <CardHeader>
              <div className="flex items-center justify-between gap-3">
                <CardTitle>
                  {review.title} · {review.userName}
                </CardTitle>
                <StatusPill tone="pending">待你审核</StatusPill>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm leading-6">{review.reason}</p>
              {range ? (
                <p className="bg-muted rounded-md px-3 py-2 text-sm">
                  {review.type === "LEAVE" ? "请假时间" : "离监时间"}：{range}
                </p>
              ) : null}
              {review.archiveSnapshot ? (
                <p className="bg-muted rounded-md px-3 py-2 text-sm">
                  关联档案：{String(review.archiveSnapshot.formName ?? "档案")}{" "}
                  · {String(review.archiveSnapshot.code ?? "未编号")}
                </p>
              ) : null}
              <Textarea
                value={comments[review.id] ?? ""}
                onChange={(event) =>
                  setComments((current) => ({
                    ...current,
                    [review.id]: event.target.value,
                  }))
                }
                placeholder="审核意见（可选）"
              />
              <div className="flex flex-wrap gap-2">
                <Button
                  disabled={action.isPending}
                  onClick={() =>
                    action.mutate({ id: review.id, result: "APPROVED" })
                  }
                >
                  <CheckCircle2 />
                  通过
                </Button>
                <Button
                  variant="outline"
                  disabled={action.isPending}
                  onClick={() =>
                    action.mutate({ id: review.id, result: "RETURNED" })
                  }
                >
                  <RotateCcw />
                  退回
                </Button>
                <Button
                  variant="outline"
                  disabled={action.isPending}
                  onClick={() =>
                    action.mutate({ id: review.id, result: "REJECTED" })
                  }
                >
                  <XCircle />
                  驳回
                </Button>
              </div>
            </CardContent>
          </Card>
        )
      })}
      {pending.length === 0 ? (
        <EmptyState
          icon={FileStack}
          title="暂无待处理申请"
          description="轮到你审核的申请会显示在这里。"
        />
      ) : null}
    </div>
  )
}
