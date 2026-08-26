"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  AlertTriangle,
  ArrowLeft,
  CalendarDays,
  CalendarCheck2,
  CheckCircle2,
  ChevronDown,
  Clock3,
  FilePenLine,
  LocateFixed,
  LocateOff,
  MapPin,
  ShieldCheck,
  TimerReset,
} from "lucide-react"
import Link from "next/link"
import { useEffect, useState } from "react"
import { z } from "zod"

import { requestApi } from "@/components/shared/api-client"
import { EmptyState } from "@/components/shared/empty-state"
import { MetricCell } from "@/components/shared/metric-cell"
import { PageHeader } from "@/components/shared/page-header"
import { StatusPill, type StatusTone } from "@/components/shared/status-pill"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { toast } from "@/components/ui/toast"
import { PRISONER_CUSTODY_STATUS_LABELS } from "@/lib/constants"
import { cn } from "@/lib/utils"

const Checkin = z.object({
  id: z.string(),
  ruleName: z.string(),
  slotLabel: z.string().nullable(),
  slotIndex: z.number(),
  scheduleAt: z.string(),
  deadline: z.string(),
  status: z.string(),
  needLocation: z.boolean(),
  allowNoLocation: z.boolean(),
  needRemark: z.boolean(),
  recordStatus: z.string().nullable(),
  checkinAt: z.string().nullable(),
  remark: z.string().nullable(),
  recordLocation: z.record(z.string(), z.unknown()).nullable(),
  recordLocationSource: z.string().nullable(),
  recordLat: z.string().nullable(),
  recordLng: z.string().nullable(),
  recordGpsExpiresAt: z.string().nullable(),
  makeupId: z.string().nullable(),
  makeupStatus: z.string().nullable(),
})
const Checkins = z.array(Checkin)

const CustodyProfile = z.object({
  custodyLevel: z.string(),
  custodyStatus: z.enum(["IN_CUSTODY", "ON_LEAVE", "OUT_OF_CUSTODY"]),
  canCheckin: z.boolean(),
  leaveWorkflowEligible: z.boolean(),
  geofenceApplicable: z.boolean(),
})

const Makeup = z.object({
  id: z.string(),
  taskId: z.string(),
  userId: z.string().optional(),
  userName: z.string().optional(),
  ruleName: z.string(),
  reason: z.string(),
  status: z.string(),
  reviewComment: z.string().nullable().optional(),
  date: z.string().optional(),
  createdAt: z.string(),
})
const Makeups = z.array(Makeup)

const SupervisionCheckin = Checkin.extend({
  supervisedId: z.string(),
  supervisedName: z.string(),
})
const SupervisionCheckins = z.array(SupervisionCheckin)

function timeText(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value))
}

function dateText(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value))
}

function locationLine(task: {
  recordStatus: string | null
  recordLocation: Record<string, unknown> | null
  recordLocationSource: string | null
  recordLat: string | null
  recordLng: string | null
  recordGpsExpiresAt: string | null
}) {
  if (!task.recordStatus) return null
  const source = task.recordLocationSource
  if (source === "GPS" && task.recordLat && task.recordLng) {
    const expiry = task.recordGpsExpiresAt
      ? ` · 保留至 ${new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric" }).format(new Date(task.recordGpsExpiresAt))}`
      : ""
    return `GPS ${Number(task.recordLat).toFixed(4)}, ${Number(task.recordLng).toFixed(4)}${expiry}`
  }
  if (source === "GPS_PURGED" || (source === "GPS" && !task.recordLat)) {
    const ipLabel = (task.recordLocation?.ip as { label?: string } | undefined)
      ?.label
    return ipLabel
      ? `IP 定位 ${ipLabel} · GPS 坐标已清除`
      : "GPS 坐标已清除（超 3 天）"
  }
  if (source === "IP") {
    const label = task.recordLocation?.label
    return `IP 定位 ${typeof label === "string" && label ? label : "（不可用）"}`
  }
  return null
}

function statusText(status: string) {
  return (
    {
      PENDING: "待打卡",
      COMPLETED: "已打卡",
      LATE: "迟到",
      MISSED: "缺卡",
      MAKEUP_PENDING: "补卡审核中",
      MAKEUP_APPROVED: "补卡已通过",
      MAKEUP_REJECTED: "补卡未通过",
      ON_TIME: "准时",
      APPROVED: "已通过",
      REJECTED: "已拒绝",
    }[status] ?? status
  )
}

function statusTone(status: string): StatusTone {
  if (["COMPLETED", "MAKEUP_APPROVED", "ON_TIME", "APPROVED"].includes(status))
    return "success"
  if (["MISSED", "MAKEUP_REJECTED", "REJECTED"].includes(status))
    return "danger"
  if (["LATE", "MAKEUP_PENDING"].includes(status)) return "warning"
  return "info"
}

type CheckinTask = z.infer<typeof Checkin>

function useLiveNow() {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000)
    return () => window.clearInterval(timer)
  }, [])
  return now
}

function formatCountdown(milliseconds: number) {
  const totalSeconds = Math.max(0, Math.ceil(milliseconds / 1_000))
  const hours = Math.floor(totalSeconds / 3_600)
  const minutes = Math.floor((totalSeconds % 3_600) / 60)
  const seconds = totalSeconds % 60
  if (hours > 0) return `${hours}时 ${minutes}分 ${seconds}秒`
  return `${minutes}分 ${seconds}秒`
}

function getCheckinTiming(task: CheckinTask, now: number) {
  const scheduleAt = new Date(task.scheduleAt).getTime()
  const deadline = new Date(task.deadline).getTime()
  if (now < scheduleAt)
    return {
      phase: "upcoming" as const,
      label: `距可打卡 ${formatCountdown(scheduleAt - now)}`,
    }
  if (now <= deadline)
    return {
      phase: "active" as const,
      label: `距截止 ${formatCountdown(deadline - now)}`,
    }
  return { phase: "expired" as const, label: "本时段已截止" }
}

function getGpsLocation() {
  return new Promise<{ lat: number; lng: number; accuracy?: number }>(
    (resolve, reject) => {
      if (!window.isSecureContext) {
        reject(new Error("GPS 需要 HTTPS 环境"))
        return
      }
      if (!navigator.geolocation) {
        reject(new Error("浏览器不支持 GPS"))
        return
      }
      navigator.geolocation.getCurrentPosition(
        (position) =>
          resolve({
            lat: position.coords.latitude,
            lng: position.coords.longitude,
            accuracy: position.coords.accuracy,
          }),
        () => reject(new Error("无法获取定位，请授权或改用 IP 定位")),
        { enableHighAccuracy: true, timeout: 12_000, maximumAge: 0 },
      )
    },
  )
}

function CheckinCard({
  task,
  compact = false,
  variant = "action",
}: {
  task: CheckinTask
  compact?: boolean
  variant?: "action" | "record"
}) {
  const client = useQueryClient()
  const [remark, setRemark] = useState("")
  const [gpsEnabled, setGpsEnabled] = useState(false)
  const [gpsError, setGpsError] = useState<string | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [makeupReason, setMakeupReason] = useState("")
  const [showMakeup, setShowMakeup] = useState(false)
  const checkin = useMutation({
    mutationFn: async () => {
      const location = gpsEnabled ? await getGpsLocation() : undefined
      return requestApi("/api/checkins", z.object({ id: z.string() }), {
        method: "POST",
        body: JSON.stringify({
          taskId: task.id,
          remark,
          location,
          locationSource: gpsEnabled ? "GPS" : "IP",
        }),
      })
    },
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["checkins"] })
      toast.success("打卡已记录")
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : "打卡失败"
      setGpsError(gpsEnabled ? message : null)
      toast.error(message)
    },
  })
  const makeup = useMutation({
    mutationFn: async () => {
      const location = gpsEnabled ? await getGpsLocation() : undefined
      return requestApi("/api/makeups", z.object({ id: z.string() }), {
        method: "POST",
        body: JSON.stringify({
          taskId: task.id,
          reason: makeupReason,
          location,
          locationSource: gpsEnabled ? "GPS" : "IP",
        }),
      })
    },
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["checkins"] })
      client.invalidateQueries({ queryKey: ["makeups"] })
      setShowMakeup(false)
      toast.success("补卡申请已提交")
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "申请失败"),
  })
  const canMakeup = ["MISSED", "LATE", "MAKEUP_REJECTED"].includes(task.status)
  const now = useLiveNow()
  const timing = getCheckinTiming(task, now)
  const isAvailable = task.status === "PENDING" && timing.phase === "active"

  return (
    <Card
      className={cn(
        compact
          ? "border-0 bg-transparent p-0 shadow-none [--card-spacing:--spacing(3)]"
          : "page-enter surface-panel--interactive shadow-soft border-0",
      )}
    >
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle>
              {task.slotLabel ? `${task.slotLabel} · ` : ""}
              {task.ruleName}
            </CardTitle>
            <p className="text-muted-foreground mt-2 flex items-center gap-1.5 text-xs">
              <Clock3 className="size-3.5" />
              {timeText(task.scheduleAt)} 打卡 · {timeText(task.deadline)} 截止
            </p>
          </div>
          <StatusPill tone={statusTone(task.status)}>
            {statusText(task.status)}
          </StatusPill>
        </div>
      </CardHeader>
      <CardContent className={compact ? "space-y-3" : "space-y-4"}>
        {task.status === "PENDING" && variant === "record" && (
          <Button variant="brand" asChild>
            <Link href="/my">
              <ArrowLeft className="size-4" />
              前往首页打卡
            </Link>
          </Button>
        )}
        {task.status === "PENDING" && variant === "action" && (
          <>
            {task.needRemark && (
              <div className="space-y-2">
                <Label>打卡备注</Label>
                <Input
                  value={remark}
                  onChange={(event) => setRemark(event.target.value)}
                  placeholder="填写本次打卡说明"
                />
              </div>
            )}
            <div className="space-y-2">
              <button
                type="button"
                className={cn(
                  "flex w-full items-center justify-between gap-3 rounded-xl border px-3.5 py-2.5 text-left transition-colors",
                  settingsOpen
                    ? "border-brand-500/40 bg-brand-500/[0.06]"
                    : "border-border/70 bg-muted/30 hover:border-border hover:bg-muted/50",
                )}
                onClick={() => setSettingsOpen((open) => !open)}
                aria-expanded={settingsOpen}
              >
                <span className="flex min-w-0 items-center gap-2">
                  <LocateFixed className="text-brand-700 size-4 shrink-0" />
                  <span className="text-foreground text-sm font-medium">
                    定位设置
                  </span>
                  <span
                    className={cn(
                      "shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium",
                      gpsEnabled
                        ? "bg-brand-500/15 text-brand-700"
                        : "bg-muted text-muted-foreground",
                    )}
                  >
                    {gpsEnabled ? "GPS" : "IP 定位"}
                  </span>
                </span>
                <ChevronDown
                  className={cn(
                    "text-muted-foreground size-4 shrink-0 transition-transform duration-200",
                    settingsOpen && "rotate-180",
                  )}
                />
              </button>
              {settingsOpen && (
                <div className="border-border/70 bg-muted/30 space-y-2.5 rounded-xl border px-3.5 py-3">
                  <button
                    type="button"
                    role="switch"
                    aria-checked={gpsEnabled}
                    aria-label="启用精确 GPS 定位"
                    disabled={checkin.isPending}
                    onClick={() => {
                      setGpsEnabled((v) => !v)
                      setGpsError(null)
                    }}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-lg border-2 px-3 py-2.5 text-left transition-all",
                      gpsEnabled
                        ? "border-brand-500 bg-brand-500/10"
                        : "border-border/80 bg-background hover:border-brand-500/40",
                    )}
                  >
                    <span
                      className={cn(
                        "relative h-6 w-11 shrink-0 rounded-full transition-colors",
                        gpsEnabled ? "bg-brand-500" : "bg-input",
                      )}
                    >
                      <span
                        className={cn(
                          "bg-background absolute top-0.5 size-5 rounded-full shadow-sm transition-transform",
                          gpsEnabled ? "translate-x-[22px]" : "translate-x-0.5",
                        )}
                      />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="text-foreground block text-sm font-medium">
                        精确 GPS
                      </span>
                      <span className="text-muted-foreground mt-0.5 block text-xs leading-5">
                        坐标 3 天后自动清除
                      </span>
                    </span>
                    {gpsEnabled ? (
                      <CheckCircle2 className="text-brand-700 size-4 shrink-0" />
                    ) : (
                      <LocateOff className="text-muted-foreground/60 size-4 shrink-0" />
                    )}
                  </button>
                  {gpsEnabled && !window.isSecureContext && (
                    <p className="bg-warning/10 text-warning flex items-start gap-2 rounded-lg px-3 py-2 text-xs leading-5">
                      <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                      HTTP 下 GPS 不可用，请改用 HTTPS
                    </p>
                  )}
                </div>
              )}
              {gpsError && (
                <p className="bg-destructive/10 text-destructive flex items-start gap-2 rounded-lg px-3 py-2 text-xs leading-5">
                  <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                  {gpsError}
                </p>
              )}
            </div>
            <Button
              disabled={checkin.isPending || !isAvailable}
              onClick={() => {
                setGpsError(null)
                checkin.mutate()
              }}
            >
              <CheckCircle2 />
              {checkin.isPending
                ? "正在记录…"
                : isAvailable
                  ? `${timing.label} · 立即打卡`
                  : timing.label}
            </Button>
          </>
        )}
        {task.recordStatus && (
          <div className="bg-muted/60 space-y-1.5 rounded-lg px-3 py-2.5">
            <p className="text-foreground text-sm">
              {statusText(task.recordStatus)}：
              {task.checkinAt ? dateText(task.checkinAt) : "已记录"}
              {task.remark ? ` · ${task.remark}` : ""}
            </p>
            {locationLine(task) && (
              <p className="text-muted-foreground flex items-center gap-1.5 text-xs">
                <MapPin className="size-3.5 shrink-0" />
                {locationLine(task)}
              </p>
            )}
          </div>
        )}
        {task.makeupStatus && (
          <p className="bg-muted/60 text-foreground rounded-lg px-3 py-2 text-sm">
            补卡状态：{statusText(task.makeupStatus)}
          </p>
        )}
        {canMakeup && !task.makeupId && !showMakeup && (
          <Button variant="outline" onClick={() => setShowMakeup(true)}>
            <TimerReset />
            申请补卡
          </Button>
        )}
        {showMakeup && (
          <div className="border-warning/30 bg-warning/10 space-y-3 rounded-xl border p-3">
            <Label>补卡原因</Label>
            <Textarea
              value={makeupReason}
              onChange={(event) => setMakeupReason(event.target.value)}
              placeholder="简要说明原因"
            />
            <div className="flex gap-2">
              <Button
                disabled={makeupReason.trim().length < 2 || makeup.isPending}
                onClick={() => makeup.mutate()}
              >
                <FilePenLine />
                提交申请
              </Button>
              <Button variant="ghost" onClick={() => setShowMakeup(false)}>
                取消
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

export function CheckinPanel() {
  const custodyProfile = useQuery({
    queryKey: ["custody-profile"],
    queryFn: () => requestApi("/api/my/custody-profile", CustodyProfile),
  })
  const checkins = useQuery({
    queryKey: ["checkins"],
    queryFn: () => requestApi("/api/checkins", Checkins),
    enabled: custodyProfile.data?.canCheckin === true,
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
        title="打卡记录"
        description="按时间查看全天打卡状态；逾期可提交补卡申请。"
        action={
          <Button variant="outline" asChild>
            <Link href="/my">
              <ArrowLeft />
              返回首页
            </Link>
          </Button>
        }
      />
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
        {custodyProfile.data && !custodyProfile.data.canCheckin && (
          <div className="surface-panel surface-panel--brand page-enter p-5 sm:p-6">
            <p className="text-foreground font-medium">
              当前为
              {
                PRISONER_CUSTODY_STATUS_LABELS[
                  custodyProfile.data.custodyStatus
                ]
              }
              状态，无需执行打卡
            </p>
            <p className="text-muted-foreground mt-2 text-sm">
              囚犯状态已作为请假审批和地理围栏判定的统一接口预留；状态恢复为在押后，将按监管级别自动生成当日打卡。
            </p>
          </div>
        )}
        {custodyProfile.data?.canCheckin &&
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
                  <CheckinCard key={task.id} task={task} variant="record" />
                ))}
              </div>
            </section>
          )}
      </div>
      {custodyProfile.data?.canCheckin && checkins.data?.length === 0 && (
        <div className="surface-panel surface-panel--interactive">
          <EmptyState
            icon={MapPin}
            title="今日暂无需要打卡的时段"
            description="新时段生成后会按时间顺序显示在这里。"
          />
        </div>
      )}
    </div>
  )
}

export function CheckinHomeCard() {
  const custodyProfile = useQuery({
    queryKey: ["custody-profile"],
    queryFn: () => requestApi("/api/my/custody-profile", CustodyProfile),
  })
  const checkins = useQuery({
    queryKey: ["checkins"],
    queryFn: () => requestApi("/api/checkins", Checkins),
    enabled: custodyProfile.data?.canCheckin === true,
  })
  const now = useLiveNow()
  const currentTask = checkins.data
    ?.filter((task) => task.status === "PENDING")
    .sort((left, right) => {
      const phaseRank = (task: CheckinTask) => {
        const phase = getCheckinTiming(task, now).phase
        return phase === "active" ? 0 : phase === "upcoming" ? 1 : 2
      }
      return (
        phaseRank(left) - phaseRank(right) ||
        new Date(left.scheduleAt).getTime() -
          new Date(right.scheduleAt).getTime()
      )
    })[0]

  if (custodyProfile.data && !custodyProfile.data.canCheckin) return null
  if (!currentTask) return null

  return (
    <section className="space-y-3" aria-label="今日打卡">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <p className="text-muted-foreground text-xs">
          定位默认 IP，可在下方切换 GPS
        </p>
        <Link
          href="/my/checkins"
          className="text-brand-700 hover:text-brand-900 ml-auto text-xs font-semibold transition-colors"
        >
          查看记录 →
        </Link>
      </div>
      <CheckinCard task={currentTask} compact />
    </section>
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
      toast.success("补卡审核已完成")
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
              {makeup.userName ?? "被监管人"} · 申请于{" "}
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
        title="补卡审核"
        description="仅展示你监管范围内等待处理的补卡申请。"
      />
      {makeups.data?.map((makeup) => (
        <MakeupReviewCard key={makeup.id} makeup={makeup} />
      ))}
      {makeups.data?.length === 0 && (
        <div className="surface-panel motion-item">
          <EmptyState
            icon={TimerReset}
            title="暂无待审核补卡申请"
            description="新的补卡申请会按提交时间出现在这里。"
          />
        </div>
      )}
    </div>
  )
}

export function DailyCheckins() {
  const checkins = useQuery({
    queryKey: ["supervision-checkins"],
    queryFn: () => requestApi("/api/supervision/checkins", SupervisionCheckins),
  })
  return (
    <div className="workspace-stack mx-auto max-w-5xl">
      <PageHeader
        eyebrow="监管执行"
        title="日常打卡"
        description="集中查看今日各时段打卡状态与位置。"
      />
      <Card className="page-enter">
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[680px] text-sm">
              <thead className="bg-muted/60 text-muted-foreground text-left text-xs">
                <tr>
                  <th className="px-5 py-3">被监管人</th>
                  <th className="px-5 py-3">打卡规则</th>
                  <th className="px-5 py-3">时段</th>
                  <th className="px-5 py-3">截止</th>
                  <th className="px-5 py-3">打卡位置</th>
                  <th className="px-5 py-3">状态</th>
                </tr>
              </thead>
              <tbody className="divide-border/60 divide-y">
                {checkins.data?.map((task) => (
                  <tr key={task.id} className="hover:bg-muted/30">
                    <td className="text-foreground px-5 py-4 font-medium">
                      {task.supervisedName}
                    </td>
                    <td className="text-muted-foreground px-5 py-4">
                      {task.ruleName}
                    </td>
                    <td className="font-numeric text-muted-foreground px-5 py-4">
                      {timeText(task.scheduleAt)}
                    </td>
                    <td className="font-numeric text-muted-foreground/80 px-5 py-4">
                      {timeText(task.deadline)}
                    </td>
                    <td className="text-muted-foreground max-w-[16rem] px-5 py-4">
                      {locationLine(task) ? (
                        <span className="flex items-center gap-1.5">
                          <MapPin className="size-3.5 shrink-0" />
                          <span className="truncate">{locationLine(task)}</span>
                        </span>
                      ) : (
                        <span className="text-muted-foreground/50">—</span>
                      )}
                    </td>
                    <td className="px-5 py-4">
                      <StatusPill tone={statusTone(task.status)}>
                        {statusText(task.status)}
                      </StatusPill>
                    </td>
                  </tr>
                ))}
                {checkins.data?.length === 0 && (
                  <tr>
                    <td
                      colSpan={6}
                      className="text-muted-foreground p-10 text-center"
                    >
                      今日暂无打卡任务
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
