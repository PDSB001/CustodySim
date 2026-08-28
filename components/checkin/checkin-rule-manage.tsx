"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { CalendarCheck2, Clock3, Plus } from "lucide-react"
import { useState } from "react"
import { z } from "zod"

import { requestApi } from "@/components/shared/api-client"
import { EmptyState } from "@/components/shared/empty-state"
import { IconChip } from "@/components/shared/icon-chip"
import { PageHeader } from "@/components/shared/page-header"
import { StatusPill } from "@/components/shared/status-pill"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { TimePicker } from "@/components/ui/time-picker"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { toast } from "@/components/ui/toast"
import { CUSTODY_LEVEL_LABELS, CUSTODY_LEVELS } from "@/lib/constants"

const Rule = z.object({
  id: z.string(),
  name: z.string(),
  timeSlots: z.array(z.string()),
  timeoutMinutes: z.number(),
  custodyLevel: z.enum(CUSTODY_LEVELS).nullable(),
  slotSettings: z.array(
    z.object({
      label: z.string(),
      time: z.string(),
      timeoutMinutes: z.number(),
    }),
  ),
  enabled: z.boolean(),
  scopes: z.array(z.object({ id: z.string() })),
})

export function CheckinRuleManage() {
  const client = useQueryClient()
  const [name, setName] = useState("")
  const [slot, setSlot] = useState("06:30")
  const [timeoutMinutes, setTimeoutMinutes] = useState(30)
  const [custodyLevel, setCustodyLevel] = useState("GENERAL")
  const rules = useQuery({
    queryKey: ["checkin-rules"],
    queryFn: () => requestApi("/api/admin/checkin-rules", z.array(Rule)),
  })
  const create = useMutation({
    mutationFn: () =>
      requestApi("/api/admin/checkin-rules", Rule, {
        method: "POST",
        body: JSON.stringify({
          name,
          timeSlots: [slot],
          timeoutMinutes,
          custodyLevel,
          slotSettings: [{ label: name, time: slot, timeoutMinutes }],
        }),
      }),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["checkin-rules"] })
      setName("")
      toast.success("打卡规则已创建")
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "创建失败"),
  })
  return (
    <div className="workspace-stack">
      <PageHeader
        eyebrow="日常监管"
        title="打卡规则"
        description="系统已内置严管 C、普管 B、宽管 A 三套规则；仅在押人员按自身监管级别执行。"
      />
      <Card>
        <CardContent className="p-5 sm:p-6">
          <div className="border-border/60 mb-5 flex items-center gap-3 border-b pb-4">
            <IconChip icon={CalendarCheck2} tone="brand" />
            <div>
              <p className="text-foreground text-sm font-semibold">
                追加级别打卡时段
              </p>
              <p className="text-muted-foreground mt-1 text-xs">
                追加内容会应用于该监管级别的全部在押人员。
              </p>
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-2">
              <Label>规则名称</Label>
              <Input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="例如：早操打卡"
              />
            </div>
            <div className="space-y-2">
              <Label>打卡时间</Label>
              <TimePicker value={slot} onValueChange={setSlot} />
            </div>
            <div className="space-y-2">
              <Label>有效时长（分钟）</Label>
              <Input
                type="number"
                min="1"
                max="10080"
                value={timeoutMinutes}
                onChange={(event) =>
                  setTimeoutMinutes(Number(event.target.value))
                }
              />
            </div>
            <div className="space-y-2">
              <Label>适用监管级别</Label>
              <Select value={custodyLevel} onValueChange={setCustodyLevel}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CUSTODY_LEVELS.map((level) => (
                    <SelectItem key={level} value={level}>
                      {CUSTODY_LEVEL_LABELS[level]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="border-info/30 bg-info/10 mt-5 flex items-center justify-between gap-3 rounded-md border px-4 py-3">
            <p className="text-info flex items-center gap-2 text-sm">
              <Clock3 className="size-4" />
              {slot} 开始，{timeoutMinutes} 分钟内完成打卡
            </p>
            <Button
              variant="brand"
              disabled={!name || create.isPending}
              onClick={() => create.mutate()}
            >
              <Plus />
              创建打卡规则
            </Button>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-0">
          <div className="border-border/60 text-foreground border-b px-5 py-4 text-sm font-semibold">
            已启用规则
          </div>
          <div className="divide-border/60 divide-y">
            {rules.data?.map((rule) => (
              <div
                key={rule.id}
                className="hover:bg-muted/30 flex items-center justify-between gap-4 px-5 py-4"
              >
                <div className="min-w-0">
                  <p className="text-foreground font-medium">{rule.name}</p>
                  <p className="text-muted-foreground mt-1 text-xs">
                    {rule.custodyLevel
                      ? `${CUSTODY_LEVEL_LABELS[rule.custodyLevel]} · `
                      : "通用 · "}
                    {(rule.slotSettings.length
                      ? rule.slotSettings.map(
                          (slot) =>
                            `${slot.label} ${slot.time}（${slot.timeoutMinutes} 分钟）`,
                        )
                      : rule.timeSlots.map(
                          (slot) => `${slot}（${rule.timeoutMinutes} 分钟）`,
                        )
                    ).join("、")}
                  </p>
                </div>
                <StatusPill tone={rule.enabled ? "success" : "neutral"}>
                  {rule.enabled ? "已启用" : "已停用"}
                </StatusPill>
              </div>
            ))}
            {rules.data?.length === 0 && (
              <EmptyState
                icon={CalendarCheck2}
                title="暂无打卡规则"
                description="完成上方表单后即可创建第一条打卡规则。"
              />
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
