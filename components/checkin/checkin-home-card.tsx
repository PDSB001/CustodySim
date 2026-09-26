"use client"

import { useQuery } from "@tanstack/react-query"

import { requestApi } from "@/components/shared/api-client"
import { ErrorState, LoadingBlock } from "@/components/shared/query-state-view"
import { PRISONER_CUSTODY_STATUS_LABELS } from "@/lib/constants"
import { CustodyProfileSchema } from "@/lib/custody-profile-schema"

import {
  CheckinCard,
  Checkins,
  getCheckinTiming,
  useLiveNow,
  type CheckinTask,
} from "./checkin-card"

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
  const now = useLiveNow(
    checkins.data?.some((task) => task.status === "PENDING") ? 60_000 : null,
  )
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

  return <section aria-label="今日打卡">{body}</section>
}
