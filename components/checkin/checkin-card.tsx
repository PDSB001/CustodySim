"use client"

import { useMutation, useQueryClient } from "@tanstack/react-query"
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  ChevronDown,
  Clock3,
  FilePenLine,
  LocateFixed,
  LocateOff,
  MapPin,
  TimerReset,
} from "lucide-react"
import Link from "next/link"
import { useEffect, useState } from "react"
import { z } from "zod"

import { requestApi } from "@/components/shared/api-client"
import {
  ImageGallery,
  ImageUploadField,
} from "@/components/shared/image-upload-field"
import { StatusPill, type StatusTone } from "@/components/shared/status-pill"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { toast } from "@/components/ui/toast"
import { cn } from "@/lib/utils"
import { subscribeVisibleInterval } from "@/lib/visible-interval"

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
export const Checkins = z.array(Checkin)

export function timeText(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value))
}

export function dateText(value: string) {
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

export function statusText(status: string) {
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

export function statusTone(status: string): StatusTone {
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

export type CheckinTask = z.infer<typeof Checkin>

/**
 * 当前时间。
 * intervalMs 默认 1 秒（打卡倒计时需要秒级）；不需要秒级精度的场景
 * （历史记录列表、只要判断时段相位的排序）传大值，避免整页每秒重渲染。
 */
export function useLiveNow(intervalMs: number | null = 1_000) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (intervalMs === null) return
    return subscribeVisibleInterval(() => setNow(Date.now()), intervalMs)
  }, [intervalMs])
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

export function getCheckinTiming(task: CheckinTask, now: number) {
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

export function CheckinCard({
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
  // 已完成卡片没有时间相位变化，无需保留计时器。
  const now = useLiveNow(
    task.status === "PENDING" ? (variant === "action" ? 1_000 : 60_000) : null,
  )
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
