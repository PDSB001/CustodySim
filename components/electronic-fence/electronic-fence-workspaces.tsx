"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { CircleAlert, MapPinned, RadioTower, ShieldCheck } from "lucide-react"
import { useEffect, useState } from "react"
import { z } from "zod"

import { TencentFenceMap } from "@/components/electronic-fence/tencent-fence-map"
import { requestApi } from "@/components/shared/api-client"
import { EmptyState } from "@/components/shared/empty-state"
import { PageHeader } from "@/components/shared/page-header"
import { StatusPill } from "@/components/shared/status-pill"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { toast } from "@/components/ui/toast"
import { CustodyProfileSchema } from "@/lib/custody-profile-schema"

const FenceSchema = z.object({
  id: z.string(),
  name: z.string(),
  latitude: z.number(),
  longitude: z.number(),
  radiusMeters: z.number(),
  boundaryPoints: z.array(z.object({ latitude: z.number(), longitude: z.number() })).default([]),
  coordinateSystem: z.literal("GCJ02"),
  enabled: z.boolean().optional(),
  updatedAt: z.string(),
  latestLocation: z
    .object({
      reportedAt: z.string().nullable(),
      verdict: z.string().nullable(),
      transition: z.string().nullable(),
    })
    .nullable()
    .optional(),
})

const AdminFenceSchema = z.object({
  defaultFence: FenceSchema.nullable(),
  persons: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      userId: z.string(),
      fence: FenceSchema.nullable(),
    }),
  ),
})

const DeleteFenceSchema = z.object({
  userId: z.string().nullable(),
  deleted: z.boolean(),
})

type BoundaryPoint = { latitude: number; longitude: number }

const defaultFence: {
  name: string
  latitude: number
  longitude: number
  radiusMeters: number
  boundaryPoints: BoundaryPoint[]
} = {
  name: "第一监狱电子围栏",
  latitude: 39.9042,
  longitude: 116.4074,
  radiusMeters: 500,
  boundaryPoints: [],
}

export function ElectronicFenceManage() {
  const client = useQueryClient()
  const fence = useQuery({
    queryKey: ["admin-electronic-fence"],
    queryFn: () => requestApi("/api/admin/electronic-fences", AdminFenceSchema),
  })
  const [selectedUserId, setSelectedUserId] = useState("default")
  const [draft, setDraft] = useState(defaultFence)
  const [enabled, setEnabled] = useState(true)
  const selectedPerson = fence.data?.persons.find(
    (person) => person.userId === selectedUserId,
  )
  const selectedFence =
    selectedUserId === "default"
      ? fence.data?.defaultFence
      : selectedPerson?.fence
  const fallbackFence = fence.data?.defaultFence
  useEffect(() => {
    const source = selectedFence ?? fallbackFence ?? defaultFence
    if (!source) return
    setDraft({
      name: source.name,
      latitude: source.latitude,
      longitude: source.longitude,
      radiusMeters: source.radiusMeters,
      boundaryPoints: source.boundaryPoints ?? [],
    })
    setEnabled(selectedFence?.enabled ?? fallbackFence?.enabled ?? true)
  }, [fallbackFence, selectedFence])
  const save = useMutation({
    mutationFn: () =>
      requestApi("/api/admin/electronic-fences", FenceSchema, {
        method: "PUT",
        body: JSON.stringify({
          ...draft,
          enabled,
          userId:
            selectedUserId === "default"
              ? null
              : (selectedPerson?.userId ?? null),
        }),
      }),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["admin-electronic-fence"] })
      client.invalidateQueries({ queryKey: ["electronic-fence"] })
      toast.success("电子围栏已保存")
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "保存失败"),
  })
  const removePersonalFence = useMutation({
    mutationFn: () =>
      requestApi(
        `/api/admin/electronic-fences?userId=${selectedPerson?.userId ?? ""}`,
        DeleteFenceSchema,
        { method: "DELETE" },
      ),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["admin-electronic-fence"] })
      client.invalidateQueries({ queryKey: ["electronic-fence"] })
      toast.success("已删除该人员专属围栏，当前使用默认围栏")
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "恢复失败"),
  })
  const removeDefaultFence = useMutation({
    mutationFn: () =>
      requestApi("/api/admin/electronic-fences?userId=default", DeleteFenceSchema, {
        method: "DELETE",
      }),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["admin-electronic-fence"] })
      client.invalidateQueries({ queryKey: ["electronic-fence"] })
      toast.success("默认围栏已删除")
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "删除失败"),
  })
  const mapFence = draft
  return (
    <div className="workspace-stack mx-auto max-w-5xl">
      <PageHeader
        eyebrow="监管执行"
        title="电子围栏"
        description="可维护默认围栏，并为每名被监管人设置专属覆盖范围；仅处于在押状态的人员参与移动端定时定位、进出判定。"
      />
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.05fr)_minmax(18rem,.95fr)]">
        <Card className="overflow-hidden">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <MapPinned className="text-brand-600 size-4" />
              围栏地图
            </CardTitle>
          </CardHeader>
          <CardContent>
            <TencentFenceMap
              fence={mapFence}
              editable
                onPick={(point) =>
                  setDraft((value) => ({
                    ...value,
                    boundaryPoints: [...value.boundaryPoints, point],
                  }))
                }
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">围栏配置</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>配置对象</Label>
              <Select value={selectedUserId} onValueChange={setSelectedUserId}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="选择人员" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="default">
                    默认围栏（未单独设置人员使用）
                  </SelectItem>
                  {fence.data?.persons.map((person) => (
                    <SelectItem key={person.userId} value={person.userId}>
                      {person.name} · {person.fence ? "已单独设置" : "使用默认"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedUserId !== "default" && !selectedPerson?.fence ? (
                <p className="text-muted-foreground text-xs">
                  当前人员尚未单独设置，下面保存后会创建专属围栏。
                </p>
              ) : null}
            </div>
            <div className="flex items-center justify-between gap-3 rounded-lg border p-3 text-sm">
              <span>已添加 {draft.boundaryPoints.length} 个边界点（至少 3 个）</span>
              <Button type="button" variant="outline" size="sm" onClick={() => setDraft((value) => ({ ...value, boundaryPoints: [] }))}>清除点位</Button>
            </div>
            <div className="space-y-2">
              <Label>围栏名称</Label>
              <Input
                value={draft.name}
                onChange={(event) =>
                  setDraft((value) => ({ ...value, name: event.target.value }))
                }
              />
            </div>
            <div className="bg-muted/50 flex items-center justify-between rounded-lg p-3">
              <div>
                <p className="text-sm font-medium">启用围栏</p>
                <p className="text-muted-foreground mt-1 text-xs">
                  停用后移动端不作越界判定。
                </p>
              </div>
              <Switch checked={enabled} onCheckedChange={setEnabled} />
            </div>
            <Button
              className="w-full"
              disabled={
                save.isPending ||
                draft.boundaryPoints.length < 3 ||
                (selectedUserId !== "default" && !selectedPerson)
              }
              onClick={() => save.mutate()}
            >
              <ShieldCheck />
              {save.isPending
                ? "保存中…"
                : selectedUserId === "default"
                  ? "保存默认围栏"
                  : "保存人员专属围栏"}
            </Button>
            {selectedUserId !== "default" && selectedPerson?.fence ? (
              <Button
                className="w-full"
                variant="outline"
                disabled={removePersonalFence.isPending}
                onClick={() => {
                  if (
                    selectedPerson &&
                    window.confirm(
                      `确认删除“${selectedPerson.name}”的专属围栏吗？删除后该人员将使用默认围栏。`,
                    )
                  )
                    removePersonalFence.mutate()
                }}
              >
                {removePersonalFence.isPending ? "删除中…" : "删除此人专属围栏"}
              </Button>
            ) : null}
            {selectedUserId === "default" && fence.data?.defaultFence ? (
              <Button
                className="w-full"
                variant="outline"
                disabled={removeDefaultFence.isPending}
                onClick={() => {
                  if (window.confirm("确认删除默认电子围栏吗？删除后未配置专属围栏的人员将暂时不进行围栏判定。"))
                    removeDefaultFence.mutate()
                }}
              >
                {removeDefaultFence.isPending ? "删除中…" : "删除默认围栏"}
              </Button>
            ) : null}
          </CardContent>
        </Card>
      </div>
      <Card>
        <CardContent className="flex gap-3 p-5 text-sm leading-6">
          <RadioTower className="text-brand-600 mt-0.5 size-5 shrink-0" />
          <div>
            <p className="font-semibold">移动端定位接口</p>
            <p className="text-muted-foreground mt-1">
              移动端定时向 <code>/api/mobile/geofence/evaluate</code> 提交
              GCJ-02
              坐标、精度与采集时间。每次上报均写入电子围栏表；服务端按上一条与本条位置判定进入、离开或持续在范围外。
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

export function MyElectronicFence() {
  const fence = useQuery({
    queryKey: ["electronic-fence"],
    queryFn: () => requestApi("/api/electronic-fences", FenceSchema.nullable()),
  })
  const profile = useQuery({
    queryKey: ["custody-profile"],
    queryFn: () => requestApi("/api/my/custody-profile", CustodyProfileSchema),
  })
  return (
    <div className="workspace-stack mx-auto max-w-5xl">
      <PageHeader
        eyebrow="个人服务"
        title="电子围栏"
        description="此页面展示当前适用范围与最近一次移动端上报结果；网页端不采集定位。"
      />
      {fence.data ? (
        <>
          <Card>
            <CardContent className="flex flex-wrap items-center justify-between gap-4 p-5">
              <div className="flex items-start gap-3">
                <span className="bg-brand-500/10 text-brand-700 grid size-10 place-items-center rounded-lg">
                  <MapPinned className="size-5" />
                </span>
                <div>
                  <p className="font-semibold">{fence.data.name}</p>
                  <p className="text-muted-foreground mt-1 text-sm">
                    以中心点为半径 {fence.data.radiusMeters} 米的可活动范围
                  </p>
                </div>
              </div>
              <StatusPill
                tone={profile.data?.geofenceApplicable ? "success" : "neutral"}
              >
                {profile.data?.geofenceApplicable
                  ? "当前参与判定"
                  : "当前不参与判定"}
              </StatusPill>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="flex flex-wrap items-center justify-between gap-4 p-5">
              <div className="flex items-start gap-3">
                <span className="bg-brand-500/10 text-brand-700 grid size-10 place-items-center rounded-lg">
                  <MapPinned className="size-5" />
                </span>
                <div>
                  <p className="font-semibold">{fence.data.name}</p>
                  <p className="text-muted-foreground mt-1 text-sm">
                    以中心点为半径 {fence.data.radiusMeters} 米的可活动范围
                  </p>
                  <p className="text-muted-foreground mt-1 text-xs">
                    最近定位：
                    {fence.data.latestLocation?.reportedAt
                      ? new Intl.DateTimeFormat("zh-CN", {
                          dateStyle: "medium",
                          timeStyle: "short",
                        }).format(
                          new Date(fence.data.latestLocation.reportedAt),
                        )
                      : "尚未收到移动端上报"}
                    {fence.data.latestLocation?.transition
                      ? ` · ${{ INITIAL_INSIDE: "首次在围栏内", INITIAL_OUTSIDE: "首次在围栏外", ENTER: "已进入围栏", EXIT: "已离开围栏", INSIDE: "持续在围栏内", OUTSIDE: "持续在围栏外" }[fence.data.latestLocation.transition] ?? fence.data.latestLocation.transition}`
                      : ""}
                  </p>
                </div>
              </div>
              <StatusPill
                tone={profile.data?.geofenceApplicable ? "success" : "neutral"}
              >
                {profile.data?.geofenceApplicable
                  ? "当前参与判定"
                  : "当前不参与判定"}
              </StatusPill>
            </CardContent>
          </Card>
          <TencentFenceMap fence={fence.data} />
          <Card>
            <CardContent className="flex gap-3 p-5 text-sm leading-6">
              <CircleAlert className="mt-0.5 size-5 shrink-0 text-amber-600" />
              <p className="text-muted-foreground">
                仅在押状态参与围栏判断。请假状态、临时离监或未在押期间仍可记录移动端位置，但不作进出判定；在押期间首次围栏外或离开围栏时，系统会向“我的任务”下发一份原因说明。
              </p>
            </CardContent>
          </Card>
        </>
      ) : (
        <EmptyState
          icon={MapPinned}
          title="暂未配置电子围栏"
          description="管理处完成围栏配置后，可在这里查看适用范围。"
        />
      )}
    </div>
  )
}
