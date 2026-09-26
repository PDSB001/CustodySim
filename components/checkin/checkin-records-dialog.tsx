"use client"

import { useInfiniteQuery } from "@tanstack/react-query"
import { CalendarDays, MapPin, ShieldCheck, TimerReset } from "lucide-react"
import { useState } from "react"
import { z } from "zod"

import { requestApi } from "@/components/shared/api-client"
import { EmptyState } from "@/components/shared/empty-state"
import { ImageGallery } from "@/components/shared/image-upload-field"
import { ErrorState, LoadingBlock } from "@/components/shared/query-state-view"
import { StatusPill } from "@/components/shared/status-pill"
import { Button } from "@/components/ui/button"
import { DatePicker } from "@/components/ui/date-picker"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

/** 与 `lib/checkin-records.ts` 的下发字段一一对应。 */
const CheckinRecordItem = z.object({
  id: z.string(),
  taskId: z.string(),
  checkinAt: z.string(),
  status: z.string(),
  slotIndex: z.number(),
  /** 打卡照片：data URL（base64），单张约 1 MB。 */
  photoUrl: z.string().nullable(),
  location: z.unknown().optional(),
  lat: z.string().nullable(),
  lng: z.string().nullable(),
  locationSource: z.string(),
  ip: z.string().nullable(),
  clientType: z.string().nullable(),
  browserType: z.string().nullable(),
  remark: z.string().nullable(),
  taskStatus: z.string(),
  scheduleAt: z.string(),
  deadline: z.string(),
  makeupId: z.string().nullable(),
  makeupReason: z.string().nullable(),
  makeupStatus: z.string().nullable(),
  makeupComment: z.string().nullable(),
  makeupReviewedAt: z.string().nullable(),
  makeupPhotoUrl: z.string().nullable(),
})

const CheckinRecordPage = z.object({
  items: z.array(CheckinRecordItem),
  nextCursor: z.string().nullable(),
})

type CheckinRecord = z.infer<typeof CheckinRecordItem>

/** `checkin_records.status` 的中文标签（与任务状态那套不是一回事）。 */
const RECORD_STATUS_LABELS: Record<string, string> = {
  ON_TIME: "按时打卡",
  LATE: "迟到打卡",
  MAKEUP: "补卡（已批准）",
  SYSTEM_MAKEUP: "系统补卡",
}

const LOCATION_SOURCE_LABELS: Record<string, string> = {
  GPS: "GPS 定位",
  IP: "IP 定位",
  GPS_PURGED: "地点已清除",
  SYSTEM: "系统记录",
}

const CLIENT_TYPE_LABELS: Record<string, string> = {
  WEB: "网页端",
  SYSTEM: "系统",
}

const STATUS_FILTERS = [
  { value: "ON_TIME", label: "按时打卡" },
  { value: "LATE", label: "迟到打卡" },
  { value: "MAKEUP", label: "补卡" },
  { value: "SYSTEM_MAKEUP", label: "系统补卡" },
] as const

/** `YYYY-MM-DD`（本地时区）当天的 00:00 对应的 ISO 瞬间。 */
function localDayStartIso(dateKey: string, addDays = 0) {
  const [year, month, day] = dateKey.split("-").map(Number)
  return new Date(year, month - 1, day + addDays).toISOString()
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/**
 * 地点文案。
 *
 * GPS 只保留 3 天（`lib/privacy-retention.ts`），超期后服务端会把地点改成
 * `GPS_PURGED` 并清空 lat/lng —— 这里如实说明，不给"看起来有地点"的错觉。
 */
function locationText(item: CheckinRecord) {
  if (item.locationSource === "GPS_PURGED") return "地点已按保留策略清除（GPS 保留 3 天）"
  const address =
    isRecord(item.location) && typeof item.location.address === "string"
      ? item.location.address
      : null
  if (address) return address
  if (item.lat && item.lng) return `${item.lat}, ${item.lng}`
  if (item.ip) return `IP ${item.ip}`
  return null
}

function timeText(value: string) {
  return value.replace("T", " ").slice(0, 16)
}

/**
 * 空态文案要回答"为什么没有记录"，而不是干巴巴一句"没有记录"。
 *
 * 最常见的情况是：该人当天 N 个时段**全部漏点**。明细这张表只记录"实际提交的打卡"，
 * 漏点不会生成记录，所以必然是空的 —— 不把这一层说出来，就会被误读成"接口没数据/坏了"。
 */
function emptyHint({
  filtersActive,
  summary,
  dateKey,
}: {
  filtersActive: boolean
  summary?: {
    scheduledCount: number
    completedCount: number
    exceptionCount: number
  }
  dateKey?: string
}) {
  if (filtersActive) return "换个时间范围或状态再试。"
  if (!summary) return "该人员在所选范围内没有打卡记录。"
  if (summary.scheduledCount === 0) return "该人员当天没有打卡任务。"
  const day = dateKey ? `${dateKey} ` : "当天"
  if (summary.completedCount === 0)
    return `${day}共 ${summary.scheduledCount} 个打卡时段，全部未打卡（异常 ${summary.exceptionCount} 次），因此没有打卡记录 —— 漏点时段本身不产生记录。`
  return `${day}共 ${summary.scheduledCount} 个时段、已打卡 ${summary.completedCount} 次；这里只展示实际提交的打卡记录。`
}

/**
 * 按人查看打卡明细。
 *
 * 数据源 `GET /api/supervision/checkins/records`：游标 `checkinAt|id` 翻页，
 * 可见范围由服务端按角色收敛（管理员全员 / 监管员辖区 / 被监管人本人），前端不写角色分支。
 *
 * 注意：`photoUrl` 是 base64 data URL，单张约 1 MB，所以这里 `limit=15` 而不是服务端上限 100。
 */
export function CheckinRecordsDialog({
  person,
  summary,
  dateKey,
  open,
  onOpenChange,
}: {
  person: { id: string; name: string }
  /** 汇总行的计数：仅用于把空态说清楚（为什么这个人一条记录都没有）。 */
  summary?: {
    scheduledCount: number
    completedCount: number
    exceptionCount: number
  }
  /** 汇总页所选日期，拼进空态文案。 */
  dateKey?: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [status, setStatus] = useState("")
  const [fromDate, setFromDate] = useState("")
  const [toDate, setToDate] = useState("")

  const query = useInfiniteQuery({
    queryKey: ["checkin-records", person.id, status, fromDate, toDate],
    initialPageParam: null as string | null,
    // closed 时不发请求；筛选任何一项变化都会走新的 queryKey 重新取第一页。
    enabled: open,
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams({ userId: person.id, limit: "15" })
      if (status) params.set("status", status)
      if (fromDate) params.set("from", localDayStartIso(fromDate))
      // to 是开区间（服务端 < ），所以取所选日期的次日 00:00。
      if (toDate) params.set("to", localDayStartIso(toDate, 1))
      if (pageParam) params.set("cursor", pageParam)
      return requestApi(
        `/api/supervision/checkins/records?${params.toString()}`,
        CheckinRecordPage,
      )
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor,
  })

  const items = query.data?.pages.flatMap((page) => page.items) ?? []
  const filtersActive = Boolean(status || fromDate || toDate)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{person.name}的打卡记录</DialogTitle>
        </DialogHeader>

        <div className="flex flex-wrap items-center gap-3">
          <Select
            value={status || undefined}
            onValueChange={(value) => setStatus(value)}
          >
            <SelectTrigger className="h-9 min-w-32" aria-label="打卡状态筛选">
              <SelectValue placeholder="全部状态" />
            </SelectTrigger>
            <SelectContent>
              {STATUS_FILTERS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <DatePicker
            value={fromDate}
            onValueChange={(value) => setFromDate(value ?? "")}
            ariaLabel="明细起始日期"
          />
          <DatePicker
            value={toDate}
            onValueChange={(value) => setToDate(value ?? "")}
            ariaLabel="明细结束日期"
          />
          {filtersActive ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setStatus("")
                setFromDate("")
                setToDate("")
              }}
            >
              清除筛选
            </Button>
          ) : null}
        </div>

        {query.isLoading ? <LoadingBlock rows={3} /> : null}
        {query.error ? (
          <ErrorState
            compact
            title="加载打卡记录失败"
            description={
              query.error instanceof Error ? query.error.message : undefined
            }
            onRetry={() => void query.refetch()}
          />
        ) : null}
        {!query.isLoading && !query.error && items.length === 0 ? (
          <EmptyState
            icon={CalendarDays}
            title={filtersActive ? "没有符合条件的打卡记录" : "没有打卡记录"}
            description={emptyHint({ filtersActive, summary, dateKey })}
          />
        ) : null}

        <div className="space-y-3">
          {items.map((item) => {
            const location = locationText(item)
            return (
              <div key={item.id} className="bg-muted/35 rounded-xl p-3.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-foreground font-medium">
                    第 {item.slotIndex + 1} 时段 · {timeText(item.checkinAt)}
                  </p>
                  <StatusPill tone={item.status === "ON_TIME" ? "success" : "warning"}>
                    {RECORD_STATUS_LABELS[item.status] ?? item.status}
                  </StatusPill>
                </div>
                <div className="text-muted-foreground font-numeric mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
                  <span>计划 {timeText(item.scheduleAt)}</span>
                  <span>截止 {timeText(item.deadline)}</span>
                  <span>
                    {LOCATION_SOURCE_LABELS[item.locationSource] ?? item.locationSource}
                  </span>
                  {item.clientType ? (
                    <span>
                      {CLIENT_TYPE_LABELS[item.clientType] ?? item.clientType}
                      {item.browserType ? ` · ${item.browserType}` : ""}
                    </span>
                  ) : null}
                </div>
                {location ? (
                  <p className="text-muted-foreground mt-2 flex items-start gap-1.5 text-xs">
                    <MapPin className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                    <span>{location}</span>
                  </p>
                ) : null}
                {item.remark ? (
                  <p className="text-muted-foreground mt-2 text-xs">备注：{item.remark}</p>
                ) : null}
                {item.makeupId ? (
                  <div className="border-border/60 mt-3 space-y-1 border-t pt-3 text-xs">
                    <p className="text-muted-foreground flex items-center gap-1.5">
                      <TimerReset className="size-3.5 shrink-0" aria-hidden />
                      <span>补卡理由：{item.makeupReason ?? "—"}</span>
                    </p>
                    {item.makeupComment ? (
                      <p className="text-muted-foreground flex items-center gap-1.5">
                        <ShieldCheck className="size-3.5 shrink-0" aria-hidden />
                        <span>
                          审批意见：{item.makeupComment}
                          {item.makeupReviewedAt
                            ? `（${timeText(item.makeupReviewedAt)}）`
                            : ""}
                        </span>
                      </p>
                    ) : null}
                  </div>
                ) : null}
                {item.photoUrl ? (
                  <div className="mt-3">
                    <ImageGallery value={item.photoUrl} label="打卡照片" />
                  </div>
                ) : null}
                {item.makeupPhotoUrl ? (
                  <div className="mt-2">
                    <ImageGallery value={item.makeupPhotoUrl} label="补卡凭证" />
                  </div>
                ) : null}
              </div>
            )
          })}
        </div>

        {query.hasNextPage ? (
          <div className="flex justify-center pt-1">
            <Button
              variant="outline"
              size="sm"
              disabled={query.isFetchingNextPage}
              onClick={() => query.fetchNextPage()}
            >
              {query.isFetchingNextPage ? "加载中…" : "加载更早的记录"}
            </Button>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
