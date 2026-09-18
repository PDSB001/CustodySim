"use client"

import { useQuery } from "@tanstack/react-query"
import { MapPinned } from "lucide-react"
import { useEffect, useState } from "react"
import { z } from "zod"

import { formatDate, requestApi } from "@/components/shared/api-client"
import { EmptyState } from "@/components/shared/empty-state"
import { PageHeader } from "@/components/shared/page-header"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  LocationTrackMap,
  type TrackPoint,
} from "@/components/location-tracks/location-track-map"

const HOURS = [1, 3, 6, 12, 24, 48, 72]

const RosterSchema = z.array(z.object({ id: z.string(), name: z.string() }))
const TrackSchema = z.object({
  userId: z.string(),
  retentionHours: z.number(),
  truncated: z.boolean(),
  points: z.array(
    z.object({
      reportedAt: z.string().nullable(),
      latitude: z.number(),
      longitude: z.number(),
      accuracyMeters: z.number().nullable(),
      verdict: z.string().nullable(),
      transition: z.string().nullable(),
    }),
  ),
})

const VERDICT_LABELS: Record<string, string> = {
  INSIDE: "围栏内",
  OUTSIDE: "围栏外",
  NOT_CONFIGURED: "未配置围栏",
  NOT_APPLICABLE: "不适用",
}

/**
 * 位置轨迹查看页（监管员/管理员）。
 *
 * 数据来自 `/api/mobile/location/track`，保留期由隐私策略决定（当前 72 小时），
 * 所以时间范围上限也卡在 72 小时 —— 更早的坐标已被清理，查也查不到。
 * 该页面不对被监管人开放，接口层也做了同样限制。
 */
export function LocationTrackView() {
  const [userId, setUserId] = useState("")
  const [hours, setHours] = useState(6)

  // 监管范围内的在押人员名单，与打卡任务无关（当天没任务的人也要能选到）。
  const roster = useQuery({
    queryKey: ["location-track-roster"],
    queryFn: () =>
      requestApi("/api/supervision/supervised-persons", RosterSchema),
  })
  useEffect(() => {
    if (!userId && roster.data?.length) setUserId(roster.data[0]!.id)
  }, [roster.data, userId])

  const track = useQuery({
    queryKey: ["location-track", userId, hours],
    enabled: Boolean(userId),
    queryFn: () => {
      const to = new Date()
      const from = new Date(to.getTime() - hours * 3_600_000)
      return requestApi(
        `/api/mobile/location/track?userId=${userId}&from=${from.toISOString()}&to=${to.toISOString()}`,
        TrackSchema,
      )
    },
  })
  const points: TrackPoint[] = track.data?.points ?? []

  return (
    <div className="workspace-stack mx-auto max-w-5xl">
      <PageHeader
        eyebrow="监管执行"
        title="位置轨迹"
        description="按在押人员与时间范围回看移动端上报的位置采样。坐标按隐私策略只保留 72 小时，更早的记录无法查询。"
      />
      <Card>
        <CardHeader>
          <CardTitle>查询条件</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>在押人员</Label>
            <Select value={userId} onValueChange={setUserId}>
              <SelectTrigger>
                <SelectValue placeholder="请选择" />
              </SelectTrigger>
              <SelectContent>
                {(roster.data ?? []).map((row) => (
                  <SelectItem key={row.id} value={row.id}>
                    {row.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {!roster.isPending && !roster.data?.length ? (
              <p className="text-muted-foreground text-xs">
                你的监管范围内暂无在押人员。
              </p>
            ) : null}
          </div>
          <div className="space-y-2">
            <Label>时间范围</Label>
            <Select
              value={String(hours)}
              onValueChange={(value) => setHours(Number(value))}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {HOURS.map((option) => (
                  <SelectItem key={option} value={String(option)}>
                    最近 {option} 小时
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {userId && track.isPending ? (
        <p className="text-muted-foreground text-sm">正在加载轨迹…</p>
      ) : null}
      {track.error ? (
        <p className="text-destructive text-sm">
          {track.error instanceof Error ? track.error.message : "轨迹查询失败"}
        </p>
      ) : null}

      {track.data ? (
        <>
          {/* 没有采样点时不出图：地图中心是硬编码兜底坐标，画出来会误导成"人在那附近"。 */}
          {points.length ? <LocationTrackMap points={points} /> : null}
          <p className="text-muted-foreground text-xs">
            共 {points.length} 个采样点 · 坐标保留{" "}
            {track.data.retentionHours} 小时
            {track.data.truncated ? " · 已达单次返回上限，仅展示最早的部分" : ""}
          </p>
          {points.length === 0 ? (
            <EmptyState
              icon={MapPinned}
              title="该时段没有轨迹"
              description="可能是移动端未上报、上报间隔较长，或该时段的坐标已超过保留期被清除。"
            />
          ) : (
            <Card>
              <CardHeader>
                <CardTitle>采样点明细</CardTitle>
              </CardHeader>
              <CardContent className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-muted-foreground border-b text-left">
                      <th className="py-2 pr-4 font-medium">采集时间</th>
                      <th className="py-2 pr-4 font-medium">坐标</th>
                      <th className="py-2 pr-4 font-medium">精度</th>
                      <th className="py-2 font-medium">判定</th>
                    </tr>
                  </thead>
                  <tbody>
                    {points.map((point, index) => (
                      <tr
                        key={`${point.reportedAt ?? index}-${index}`}
                        className="border-border/60 border-b last:border-0"
                      >
                        <td className="py-2 pr-4 whitespace-nowrap">
                          {point.reportedAt ? formatDate(point.reportedAt) : "—"}
                        </td>
                        <td className="py-2 pr-4 font-mono text-xs">
                          {point.latitude.toFixed(6)},{" "}
                          {point.longitude.toFixed(6)}
                        </td>
                        <td className="py-2 pr-4">
                          {point.accuracyMeters === null
                            ? "—"
                            : `${point.accuracyMeters} 米`}
                        </td>
                        <td className="py-2">
                          {point.verdict
                            ? (VERDICT_LABELS[point.verdict] ?? point.verdict)
                            : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          )}
        </>
      ) : null}
    </div>
  )
}
