"use client"

import dynamic from "next/dynamic"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  ArrowLeft,
  CalendarCheck2,
  CalendarDays,
  MapPin,
  ShieldCheck,
  TimerReset,
} from "lucide-react"
import Link from "next/link"
import { useState } from "react"
import { z } from "zod"

import { requestApi } from "@/components/shared/api-client"
import { EmptyState } from "@/components/shared/empty-state"
import { ImageGallery } from "@/components/shared/image-upload-field"
import { MetricCell } from "@/components/shared/metric-cell"
import { PageHeader } from "@/components/shared/page-header"
import {
  ErrorState,
  LoadingBlock,
  QueryStateView,
} from "@/components/shared/query-state-view"
import { StatusPill } from "@/components/shared/status-pill"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { toast } from "@/components/ui/toast"
import { PRISONER_CUSTODY_STATUS_LABELS } from "@/lib/constants"
import { CustodyProfileSchema } from "@/lib/custody-profile-schema"

import {
  CheckinCard,
  Checkins,
  dateText,
  statusText,
  statusTone,
  timeText,
} from "./checkin-card"

const DatePicker = dynamic(
  () =>
    import("@/components/ui/date-picker").then((module) => module.DatePicker),
  { loading: () => <span role="status">正在加载日期筛选…</span> },
)

const Makeup = z.object({
  id: z.string(),
  taskId: z.string(),
  userId: z.string().optional(),
  userName: z.string().optional(),
  ruleName: z.string(),
  reason: z.string(),
  photoUrl: z.string().nullable().optional(),
  status: z.string(),
  reviewComment: z.string().nullable().optional(),
  date: z.string().optional(),
  createdAt: z.string(),
})
const Makeups = z.array(Makeup)

const SupervisionCheckinHistory = z.array(
  z.object({
    supervisedId: z.string(),
    supervisedName: z.string(),
    scheduledCount: z.number(),
    completedCount: z.number(),
    exceptionCount: z.number(),
    pendingCount: z.number(),
    latestCheckinAt: z.string().nullable(),
  }),
)

/** 只接受 YYYY-MM-DD，避免把非法 query 直接打给接口（接口会返回 400）。 */
function normalizeDateKey(value?: string) {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : ""
}

export function CheckinPanel() {
  const custodyProfile = useQuery({
    queryKey: ["custody-profile"],
    queryFn: () => requestApi("/api/my/custody-profile", CustodyProfileSchema),
  })
  const checkins = useQuery({
    queryKey: ["checkins"],
    queryFn: () => requestApi("/api/checkins", Checkins),
    enabled:
      custodyProfile.data?.canCheckin === true ||
      custodyProfile.data?.custodyStatus === "ON_LEAVE",
  })
  const total = checkins.data?.length ?? 0
  const completed =
    checkins.data?.filter((task) => task.status === "COMPLETED").length ?? 0
  const pending =
    checkins.data?.filter((task) => task.status === "PENDING").length ?? 0
  return (
    <div className="workspace-stack mx-auto max-w-5xl">
      <PageHeader
        eyebrow="每日执行档案"
        title="点名记录"
        description="逐项核对今日点名记录。获批请假时段由系统补记；其他漏点可按规定申请补卡。"
        action={
          <Button variant="outline" asChild>
            <Link href="/my">
              <ArrowLeft />
              返回首页
            </Link>
          </Button>
        }
      />
      <QueryStateView
        isLoading={custodyProfile.isLoading || checkins.isLoading}
        error={custodyProfile.error || checkins.error}
        isEmpty={
          !custodyProfile.isLoading &&
          !checkins.isLoading &&
          (checkins.data?.length ?? 0) === 0
        }
        onRetry={() => {
          custodyProfile.refetch()
          checkins.refetch()
        }}
        loading={<LoadingBlock rows={4} />}
        empty={
          custodyProfile.data?.custodyStatus === "ON_LEAVE" ? (
            <div className="surface-panel surface-panel--brand page-enter p-5 sm:p-6">
              <p className="text-foreground font-medium">
                当前监管状态：
                {PRISONER_CUSTODY_STATUS_LABELS[
                  custodyProfile.data.custodyStatus
                ] ?? "请假"}
                ，已到时段由系统自动补卡
              </p>
              <p className="text-muted-foreground mt-2 text-sm">
                请假期间无需手动打卡或申请补卡；已到时段会以「系统补卡」记录；状态恢复为在押后，将按监管级别自动生成当日打卡。
              </p>
            </div>
          ) : custodyProfile.data && !custodyProfile.data.canCheckin ? (
            <div className="surface-panel surface-panel--brand page-enter p-5 sm:p-6">
              <p className="text-foreground font-medium">
                当前监管状态：
                {PRISONER_CUSTODY_STATUS_LABELS[
                  custodyProfile.data.custodyStatus
                ] ?? "未知"}
                ，今日无需执行打卡
              </p>
              <p className="text-muted-foreground mt-2 text-sm">
                当前状态下无需执行打卡任务；状态恢复为在押后，会按监管级别自动生成当日打卡时段。
              </p>
            </div>
          ) : (
            <div className="surface-panel surface-panel--interactive">
              <EmptyState
                icon={MapPin}
                title="今日尚无点名安排"
                description="点名安排下达后会按时间列出，请留意规定的报到时段。"
              />
            </div>
          )
        }
      >
        <section className="metric-grid page-enter" aria-label="打卡概览">
          {[
            { label: "今日时段", value: total },
            { label: "已完成", value: completed },
            { label: "待处理", value: pending },
          ].map(({ label, value }) => (
            <MetricCell
              key={label}
              label={label}
              value={value}
              icon={CalendarCheck2}
              tone={
                label === "已完成"
                  ? "success"
                  : label === "待处理"
                    ? "warning"
                    : "brand"
              }
            />
          ))}
        </section>
        <div className="grid gap-4">
          {(custodyProfile.data?.canCheckin ||
            custodyProfile.data?.custodyStatus === "ON_LEAVE") &&
            checkins.data &&
            checkins.data.length > 0 && (
              <section>
                <div className="mb-3 flex items-center gap-3 px-1">
                  <span className="bg-brand-500/10 text-brand-700 grid size-7 place-items-center rounded-md">
                    <CalendarDays className="size-3.5" />
                  </span>
                  <div>
                    <h3 className="text-foreground text-sm font-semibold">
                      今日时段
                    </h3>
                    <p className="text-muted-foreground mt-0.5 text-xs">
                      按时间顺序保留全部执行记录
                    </p>
                  </div>
                </div>
                <div className="grid gap-3">
                  {checkins.data.map((task) => (
                    <CheckinCard
                      key={task.id}
                      task={task}
                      variant="record"
                      systemManaged={
                        custodyProfile.data?.custodyStatus === "ON_LEAVE"
                      }
                    />
                  ))}
                </div>
              </section>
            )}
        </div>
      </QueryStateView>
    </div>
  )
}

function MakeupReviewCard({ makeup }: { makeup: z.infer<typeof Makeup> }) {
  const client = useQueryClient()
  const [comment, setComment] = useState("")
  const review = useMutation({
    mutationFn: (result: "APPROVED" | "REJECTED") =>
      requestApi(`/api/makeups/${makeup.id}`, z.object({ id: z.string() }), {
        method: "PATCH",
        body: JSON.stringify({ result, comment }),
      }),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["makeup-review"] })
      toast.success("补点核准已完成")
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "审核失败"),
  })
  return (
    <Card className="page-enter surface-panel--interactive shadow-soft border-0">
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle>{makeup.ruleName}</CardTitle>
            <p className="text-muted-foreground mt-2 text-xs">
              {makeup.userName ?? "在押人员"} · 申请于{" "}
              {dateText(makeup.createdAt)}
            </p>
          </div>
          <StatusPill tone={statusTone(makeup.status)}>
            {statusText(makeup.status)}
          </StatusPill>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="bg-muted/60 text-foreground rounded-lg p-3 text-sm leading-6">
          {makeup.reason}
        </p>
        {makeup.photoUrl ? (
          <div>
            <p className="text-muted-foreground text-xs font-medium">
              补卡凭证
            </p>
            <ImageGallery value={makeup.photoUrl} label="补卡凭证" />
          </div>
        ) : null}
        <div className="space-y-2">
          <Label>审核说明</Label>
          <Input
            value={comment}
            onChange={(event) => setComment(event.target.value)}
            placeholder="可选"
          />
        </div>
        <div className="flex gap-2">
          <Button
            disabled={review.isPending}
            onClick={() => review.mutate("APPROVED")}
          >
            <ShieldCheck />
            通过补卡
          </Button>
          <Button
            variant="outline"
            disabled={review.isPending}
            onClick={() => review.mutate("REJECTED")}
          >
            驳回
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

export function MakeupReview() {
  const makeups = useQuery({
    queryKey: ["makeup-review"],
    queryFn: () => requestApi("/api/makeups", Makeups),
  })
  return (
    <div className="workspace-stack mx-auto max-w-5xl">
      <PageHeader
        eyebrow="监管执行"
        title="补点核准"
        description="核实所辖人员的漏点原因与补卡凭据，作出审核决定并留存意见。"
      />
      <QueryStateView
        isLoading={makeups.isLoading}
        error={makeups.error}
        isEmpty={(makeups.data?.length ?? 0) === 0}
        onRetry={() => makeups.refetch()}
        loading={<LoadingBlock rows={4} />}
        empty={
          <div className="surface-panel motion-item">
            <EmptyState
              icon={TimerReset}
              title="暂无待审核补卡申请"
              description="新的补卡申请会按提交时间出现在这里。"
            />
          </div>
        }
      >
        {makeups.data?.map((makeup) => (
          <MakeupReviewCard key={makeup.id} makeup={makeup} />
        ))}
      </QueryStateView>
    </div>
  )
}

export function DailyCheckins({ initialDate }: { initialDate?: string }) {
  return (
    <div className="workspace-stack mx-auto max-w-5xl">
      <PageHeader
        eyebrow="监管执行"
        title="点名记录"
        description="按日期核对监管范围内人员的报到、漏点与补卡情况。"
      />
      <CheckinHistory initialDate={initialDate} />
    </div>
  )
}

function CheckinHistory({ initialDate }: { initialDate?: string }) {
  // 支持从首页「今日执行」带 ?date= 直达，否则默认让用户自己选日期
  const [date, setDate] = useState(() => normalizeDateKey(initialDate))
  const history = useQuery({
    queryKey: ["supervision-checkins-history", date],
    queryFn: () =>
      requestApi(
        `/api/supervision/checkins?date=${encodeURIComponent(date)}`,
        SupervisionCheckinHistory,
      ),
    enabled: Boolean(date),
  })

  const content = (() => {
    if (!date)
      return (
        <p className="text-muted-foreground py-6 text-center text-sm">
          请选择要查看的日期。
        </p>
      )
    if (history.isLoading) return <LoadingBlock className="h-32" />
    if (history.error)
      return (
        <ErrorState
          compact
          title="历史打卡记录加载失败"
          description="请稍后重试。"
          onRetry={() => history.refetch()}
        />
      )
    if (!history.data?.length)
      return (
        <EmptyState
          icon={CalendarDays}
          title="监管范围内暂无人员"
          description="人员建立监管关系后，会在这里按日期汇总打卡情况。"
        />
      )

    return (
      <>
        <div className="grid gap-3 sm:hidden">
          {history.data.map((item) => (
            <div
              key={item.supervisedId}
              className="bg-muted/35 rounded-xl p-3.5"
            >
              <div className="flex items-center justify-between gap-3">
                <p className="text-foreground font-medium">
                  {item.supervisedName}
                </p>
                <HistoryStatus item={item} />
              </div>
              <div className="text-muted-foreground mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-xs">
                <span>
                  完成 {item.completedCount}/{item.scheduledCount}
                </span>
                {item.exceptionCount > 0 && (
                  <span>异常 {item.exceptionCount}</span>
                )}
                <span>
                  最近{" "}
                  {item.latestCheckinAt ? timeText(item.latestCheckinAt) : "—"}
                </span>
              </div>
            </div>
          ))}
        </div>
        <div className="hidden overflow-x-auto sm:block">
          <table className="w-full min-w-[580px] text-sm">
            <thead className="bg-muted/60 text-muted-foreground text-left text-xs">
              <tr>
                <th className="px-5 py-3">在押人员</th>
                <th className="px-5 py-3">打卡完成</th>
                <th className="px-5 py-3">状态</th>
                <th className="px-5 py-3">最近打卡</th>
              </tr>
            </thead>
            <tbody className="divide-border/60 divide-y">
              {history.data.map((item) => (
                <tr key={item.supervisedId} className="hover:bg-muted/30">
                  <td className="text-foreground px-5 py-4 font-medium">
                    {item.supervisedName}
                  </td>
                  <td className="font-numeric text-muted-foreground px-5 py-4">
                    {item.completedCount} / {item.scheduledCount}
                  </td>
                  <td className="px-5 py-4">
                    <HistoryStatus item={item} />
                  </td>
                  <td className="font-numeric text-muted-foreground px-5 py-4">
                    {item.latestCheckinAt
                      ? timeText(item.latestCheckinAt)
                      : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </>
    )
  })()

  return (
    <section className="space-y-3 pt-2" aria-label="历史打卡记录">
      <div className="flex flex-wrap items-end justify-between gap-3 px-1">
        <div>
          <h2 className="text-foreground text-base font-semibold">
            历史打卡记录
          </h2>
          <p className="text-muted-foreground mt-1 text-sm">
            选择日期后按人员汇总，不展开每个打卡时段的明细。
          </p>
        </div>
        <div className="w-full sm:w-52">
          <Label>查询日期</Label>
          <div className="mt-2">
            <DatePicker
              ariaLabel="查询历史打卡日期"
              value={date}
              onValueChange={setDate}
              maxDate={new Date()}
            />
          </div>
        </div>
      </div>
      <Card className="page-enter">
        <CardContent className="p-3 sm:p-0">{content}</CardContent>
      </Card>
    </section>
  )
}

function HistoryStatus({
  item,
}: {
  item: z.infer<typeof SupervisionCheckinHistory>[number]
}) {
  if (item.scheduledCount === 0)
    return <StatusPill tone="info">无打卡任务</StatusPill>
  if (item.exceptionCount > 0)
    return <StatusPill tone="danger">异常 {item.exceptionCount}</StatusPill>
  if (item.pendingCount > 0)
    return <StatusPill tone="warning">待处理 {item.pendingCount}</StatusPill>
  return <StatusPill tone="success">已完成</StatusPill>
}
