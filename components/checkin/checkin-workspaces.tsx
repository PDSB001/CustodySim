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
import {
  ImageGallery,
  ImageUploadField,
} from "@/components/shared/image-upload-field"
import { MetricCell } from "@/components/shared/metric-cell"
import {
  ErrorState,
  LoadingBlock,
  QueryStateView,
} from "@/components/shared/query-state-view"
import { PageHeader } from "@/components/shared/page-header"
import { StatusPill, type StatusTone } from "@/components/shared/status-pill"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { DatePicker } from "@/components/ui/date-picker"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { toast } from "@/components/ui/toast"
import { PRISONER_CUSTODY_STATUS_LABELS } from "@/lib/constants"
import { CustodyProfileSchema } from "@/lib/custody-profile-schema"
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
  recordPhotoUrl: z.string().nullable().optional(),
  recordLocation: z.record(z.string(), z.unknown()).nullable(),
  recordLocationSource: z.string().nullable(),
  recordLat: z.string().nullable(),
  recordLng: z.string().nullable(),
  recordGpsExpiresAt: z.string().nullable(),
  makeupId: z.string().nullable(),
  makeupStatus: z.string().nullable(),
  makeupPhotoUrl: z.string().nullable().optional(),
})
const Checkins = z.array(Checkin)

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
      MAKEUP_PENDING: "补点核准中",
      MAKEUP_APPROVED: "补卡已通过",
      MAKEUP_REJECTED: "补卡未通过",
      SYSTEM_MAKEUP: "系统补卡",
      ON_TIME: "准时",
      APPROVED: "已通过",
      REJECTED: "已拒绝",
    }[status] ?? status
  )
}

function statusTone(status: string): StatusTone {
  if (
    [
      "COMPLETED",
      "MAKEUP_APPROVED",
      "SYSTEM_MAKEUP",
      "ON_TIME",
      "APPROVED",
    ].includes(status)
  )
    return "success"
  if (["MISSED", "MAKEUP_REJECTED", "REJECTED"].includes(status))
    return "danger"
  if (["LATE", "MAKEUP_PENDING"].includes(status)) return "warning"
  return "info"
}

type CheckinTask = z.infer<typeof Checkin>

/**
 * 当前时间。
 * intervalMs 默认 1 秒（打卡倒计时需要秒级）；不需要秒级精度的场景
 * （历史记录列表、只要判断时段相位的排序）传大值，避免整页每秒重渲染。
 */
function useLiveNow(intervalMs = 1_000) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs)
    return () => window.clearInterval(timer)
  }, [intervalMs])
  return now
}

/** 只接受 YYYY-MM-DD，避免把非法 query 直接打给接口（接口会返回 400）。 */
function normalizeDateKey(value?: string) {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : ""
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

/**
 * 与 getCheckinTiming 同源，但拆成「状态 + 时间」两段，
 * 用于渲染成时间状态胶囊，而不是把倒计时塞进按钮文案里。
 */
function getCheckinPhase(task: CheckinTask, now: number) {
  const scheduleAt = new Date(task.scheduleAt).getTime()
  const deadline = new Date(task.deadline).getTime()
  if (now < scheduleAt)
    return {
      phase: "upcoming" as const,
      title: "可打卡时间未到",
      value: `${formatCountdown(scheduleAt - now)}后开放`,
    }
  if (now <= deadline)
    return {
      phase: "active" as const,
      title: "可打卡时段进行中",
      value: `距截止 ${formatCountdown(deadline - now)}`,
    }
  return { phase: "expired" as const, title: "本时段已截止", value: null }
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
  systemManaged = false,
}: {
  task: CheckinTask
  compact?: boolean
  variant?: "action" | "record"
  systemManaged?: boolean
}) {
  const client = useQueryClient()
  const [remark, setRemark] = useState("")
  const [gpsEnabled, setGpsEnabled] = useState(false)
  const [gpsError, setGpsError] = useState<string | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [makeupReason, setMakeupReason] = useState("")
  const [showMakeup, setShowMakeup] = useState(false)
  // 打卡照片与补卡凭证都是单张（沿用 photo_url 列），用数组承接共享控件的值约定
  const [photo, setPhoto] = useState<string[]>([])
  const [makeupPhoto, setMakeupPhoto] = useState<string[]>([])
  const checkin = useMutation({
    mutationFn: async () => {
      const location = gpsEnabled ? await getGpsLocation() : undefined
      return requestApi("/api/checkins", z.object({ id: z.string() }), {
        method: "POST",
        body: JSON.stringify({
          taskId: task.id,
          remark,
          photo: photo[0] ?? undefined,
          location,
          locationSource: gpsEnabled ? "GPS" : "IP",
        }),
      })
    },
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["checkins"] })
      client.invalidateQueries({ queryKey: ["dashboard-summary"] })
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
          photo: makeupPhoto[0] ?? undefined,
          location,
          locationSource: gpsEnabled ? "GPS" : "IP",
        }),
      })
    },
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["checkins"] })
      client.invalidateQueries({ queryKey: ["makeup-review"] })
      client.invalidateQueries({ queryKey: ["dashboard-summary"] })
      setShowMakeup(false)
      toast.success("补卡申请已提交")
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "申请失败"),
  })
  const canMakeup = ["MISSED", "LATE", "MAKEUP_REJECTED"].includes(task.status)
  // 只有"执行卡"需要秒级倒计时；历史记录列表用 60 秒粒度即可，避免每张卡每秒重渲染
  const now = useLiveNow(variant === "action" ? 1_000 : 60_000)
  const timing = getCheckinTiming(task, now)
  const phase = getCheckinPhase(task, now)
  const isAvailable = task.status === "PENDING" && timing.phase === "active"
  /*
   * 任务状态色语义：
   *   待执行（还没到时段）→ 蓝；进行中（时段内）→ 品牌蓝紫；
   *   已完成 → 绿；迟到/补点在审 → 黄；缺卡/驳回 → 红。
   * 其余状态沿用 statusTone 的统一映射，避免同一状态出现相近色。
   */
  const pillTone: StatusTone =
    task.status === "PENDING"
      ? timing.phase === "active"
        ? "brand"
        : "info"
      : statusTone(task.status)

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
          <div className="min-w-0">
            {/* 第一层：任务名称 + 紧邻的任务状态 */}
            <CardTitle>
              {task.slotLabel ? `${task.slotLabel} · ` : ""}
              {task.ruleName}
            </CardTitle>
            {/* 第二层：截止时间用时钟图标承载，比纯文字更容易扫到 */}
            <p className="text-muted-foreground mt-1.5 flex items-center gap-1.5 text-xs">
              <Clock3 className="size-3.5 shrink-0" />
              {timeText(task.scheduleAt)} 开始 · {timeText(task.deadline)} 截止
            </p>
          </div>
          <StatusPill tone={pillTone}>{statusText(task.status)}</StatusPill>
        </div>
      </CardHeader>
      <CardContent className={compact ? "space-y-3" : "space-y-4"}>
        {task.status === "PENDING" &&
          variant === "record" &&
          !systemManaged && (
            <Button variant="brand" asChild>
              <Link href="/my">
                <ArrowLeft className="size-4" />
                前往首页打卡
              </Link>
            </Button>
          )}
        {task.status === "PENDING" && variant === "action" && (
          <>
            {/* 第二层：当前状态 + 时间状态胶囊（提示条，不是按钮） */}
            <div
              className={cn(
                "time-capsule",
                phase.phase === "expired" && "time-capsule--expired",
              )}
            >
              <TimerReset className="size-3.5 shrink-0" />
              <span className="font-medium">{phase.title}</span>
              {phase.value ? (
                <span className="time-capsule__value">{phase.value}</span>
              ) : null}
            </div>

            {/* 第三层：必要条件（展示"当前设置"，与下方的操作按钮区分开） */}
            <dl className="text-muted-foreground flex flex-wrap items-center gap-x-5 gap-y-1.5 text-xs">
              <div className="flex items-center gap-1.5">
                <dt>定位方式</dt>
                <dd className="text-foreground font-medium">
                  {gpsEnabled ? "精确 GPS" : "IP 定位"}
                </dd>
              </div>
              <div className="flex items-center gap-1.5">
                <dt>定位要求</dt>
                <dd className="text-foreground font-medium">
                  {task.needLocation ? "需要定位" : "无需定位"}
                </dd>
              </div>
              <div className="flex items-center gap-1.5">
                <dt>打卡照片</dt>
                <dd className="text-foreground font-medium">可选</dd>
              </div>
              <div className="flex items-center gap-1.5">
                <dt>打卡备注</dt>
                <dd className="text-foreground font-medium">
                  {task.needRemark ? "需填写" : "选填"}
                </dd>
              </div>
            </dl>

            {task.needRemark && (
              <div className="space-y-2">
                <Label>打卡备注</Label>
                <Input
                  value={remark}
                  onChange={(event) => setRemark(event.target.value)}
                  placeholder="填写本次点名报到需要说明的情况"
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
                    定位方式设置
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
            <ImageUploadField
              label="打卡照片"
              hint="可选，例如现场或门牌照片"
              max={1}
              compact
              value={photo}
              onChange={setPhoto}
            />
            {/* 第四层：唯一主 CTA。不可操作时在按钮上方说明原因，而不是把倒计时写进按钮 */}
            {!isAvailable ? (
              <p className="text-muted-foreground text-xs">
                {phase.phase === "upcoming"
                  ? "尚未到打卡时间，按钮将在可打卡时段开放后可用。"
                  : "本时段已截止，如未按时打卡请按规则申请补卡。"}
              </p>
            ) : null}
            <Button
              className="w-full sm:w-auto"
              disabled={checkin.isPending || !isAvailable}
              onClick={() => {
                setGpsError(null)
                checkin.mutate()
              }}
            >
              <CheckCircle2 />
              {checkin.isPending ? "正在记录…" : "立即打卡"}
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
            {task.recordPhotoUrl ? (
              <ImageGallery value={task.recordPhotoUrl} label="打卡照片" />
            ) : null}
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
              placeholder="请说明未按时点名的原因及补卡依据"
            />
            <ImageUploadField
              label="补卡凭证照片"
              hint="可选，例如漏点截图或请假凭证"
              max={1}
              value={makeupPhoto}
              onChange={setMakeupPhoto}
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

export function CheckinHomeCard() {
  const custodyProfile = useQuery({
    queryKey: ["custody-profile"],
    queryFn: () => requestApi("/api/my/custody-profile", CustodyProfileSchema),
  })
  const checkins = useQuery({
    queryKey: ["checkins"],
    queryFn: () => requestApi("/api/checkins", Checkins),
    enabled: custodyProfile.data?.canCheckin === true,
  })
  // 这里只需要按时段相位排序，不需要秒级刷新
  const now = useLiveNow(60_000)
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

  if (custodyProfile.isLoading || checkins.isLoading)
    return <LoadingBlock className="h-24" />
  if (custodyProfile.error)
    return (
      <ErrorState
        compact
        title="打卡档案不可用"
        description="无法读取当前监管状态，请稍后重试。"
        onRetry={() => custodyProfile.refetch()}
      />
    )

  const custody = custodyProfile.data
  if (!custody) return null

  const statusLabel =
    PRISONER_CUSTODY_STATUS_LABELS[custody.custodyStatus] ?? "未知"
  const onLeave = custody.custodyStatus === "ON_LEAVE"
  let body: React.ReactNode
  if (onLeave) {
    body = (
      <div className="surface-panel surface-panel--brand p-4 text-sm">
        <p className="text-foreground font-medium">
          当前监管状态：{statusLabel}，已到时段由系统自动补卡
        </p>
        <p className="text-muted-foreground mt-1.5 text-xs leading-5">
          请假期间无需手动打卡或申请补卡；恢复在押后将按监管级别自动生成当日打卡时段。
        </p>
      </div>
    )
  } else if (!custody.canCheckin) {
    body = (
      <div className="surface-panel surface-panel--brand p-4 text-sm">
        <p className="text-foreground font-medium">
          当前监管状态：{statusLabel}，今日无需执行打卡
        </p>
        <p className="text-muted-foreground mt-1.5 text-xs leading-5">
          当前状态下无需执行打卡任务；状态恢复为在押后，会按监管级别自动生成当日打卡时段。
        </p>
      </div>
    )
  } else if (!currentTask) {
    body = (
      <p className="text-muted-foreground border-border/60 bg-muted/30 rounded-lg border border-dashed px-4 py-5 text-center text-xs">
        今日暂无待打卡时段，点名安排下达后会在此显示当前任务。
      </p>
    )
  } else {
    body = <CheckinCard task={currentTask} compact />
  }

  return (
    <section aria-label="今日打卡">{body}</section>
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
