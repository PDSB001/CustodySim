"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  CalendarClock,
  CheckCircle2,
  Clock3,
  FileText,
  Repeat2,
  Trash2,
  UsersRound,
} from "lucide-react"
import { useState } from "react"
import { z } from "zod"
import { requestApi } from "@/components/shared/api-client"
import { EmptyState } from "@/components/shared/empty-state"
import { PageHeader } from "@/components/shared/page-header"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { DatePicker } from "@/components/ui/date-picker"
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
import { cn } from "@/lib/utils"

const Rule = z.object({
  id: z.string(),
  name: z.string(),
  type: z.string(),
  freq: z.string(),
  enabled: z.boolean(),
  scheduleDays: z.array(z.number()),
  timeSlots: z.array(z.string()),
  timeoutMinutes: z.number(),
  scopes: z.array(z.object({ id: z.string() })),
})
const Group = z.object({ id: z.string(), name: z.string() })
const Template = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.string(),
})
const User = z.object({ id: z.string(), name: z.string(), role: z.string() })

const weekDays = ["一", "二", "三", "四", "五", "六", "日"]
const taskTypeLabels = {
  REPORT: "汇报类",
  STUDY: "学习类",
  LABOR: "劳动类",
}
const frequencyLabels = {
  DAILY: "每日",
  WEEKLY: "每周",
  MONTHLY: "每月",
  ONCE: "一次性",
}

function deadlinePreview(slot: string, timeoutMinutes: number) {
  const [hour, minute] = slot.split(":").map(Number)
  const total = (hour * 60 + minute + timeoutMinutes) % 1440
  const days = Math.floor((hour * 60 + minute + timeoutMinutes) / 1440)
  const deadline = `${`${Math.floor(total / 60)}`.padStart(2, "0")}:${`${total % 60}`.padStart(2, "0")}`
  return days ? `次日 ${deadline} 截止` : `${deadline} 截止`
}

export function RuleManage() {
  const client = useQueryClient()
  const [name, setName] = useState("")
  const [taskType, setTaskType] = useState("REPORT")
  const [freq, setFreq] = useState("DAILY")
  const [slot, setSlot] = useState("09:00")
  const [scheduleDays, setScheduleDays] = useState<number[]>([1])
  const [timeoutMinutes, setTimeoutMinutes] = useState(90)
  const [startDate, setStartDate] = useState(() =>
    new Date().toLocaleDateString("en-CA"),
  )
  const [groupId, setGroupId] = useState("")
  const [templateId, setTemplateId] = useState("")
  const [userId, setUserId] = useState("")
  const rules = useQuery({
    queryKey: ["rules"],
    queryFn: () => requestApi("/api/admin/rules", z.array(Rule)),
  })
  const groups = useQuery({
    queryKey: ["rule-groups"],
    queryFn: () => requestApi("/api/admin/rule-groups", z.array(Group)),
  })
  const users = useQuery({
    queryKey: ["users"],
    queryFn: () => requestApi("/api/admin/users", z.array(User)),
  })
  const templates = useQuery({
    queryKey: ["report-templates", "options"],
    queryFn: () => requestApi("/api/admin/report-templates", z.array(Template)),
  })
  const create = useMutation({
    mutationFn: () =>
      requestApi("/api/admin/rules", Rule, {
        method: "POST",
        body: JSON.stringify({
          name,
          type: taskType,
          taskType,
          freq,
          scheduleDays: freq === "DAILY" ? [] : scheduleDays,
          timeSlots: [slot],
          timeoutMinutes,
          startDate: new Date(`${startDate}T${slot}:00`).toISOString(),
          ruleGroupId: groupId || null,
          templateId: templateId || null,
          enabled: true,
          scopes: userId ? [{ targetType: "USER", targetId: userId }] : [],
        }),
      }),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["rules"] })
      setName("")
      toast.success("任务规则已创建")
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "创建失败"),
  })
  const remove = useMutation({
    mutationFn: (id: string) =>
      requestApi(`/api/admin/rules/${id}`, z.object({ id: z.string() }), {
        method: "DELETE",
      }),
    onSuccess: () => client.invalidateQueries({ queryKey: ["rules"] }),
  })
  const supervised =
    users.data?.filter((user) => user.role === "SUPERVISED") ?? []
  const taskTypeLabel =
    taskTypeLabels[taskType as keyof typeof taskTypeLabels] ?? "任务"
  const frequencyLabel =
    frequencyLabels[freq as keyof typeof frequencyLabels] ?? "周期"
  return (
    <div className="workspace-stack">
      <PageHeader
        eyebrow="监管规则"
        title="任务规则"
        description="按周期和目标对象定义任务；规则范围优先于规则组范围。"
      />
      <Card className="rule-builder page-enter">
        <CardContent className="p-4 sm:p-6 lg:p-7">
          <div className="flex flex-wrap items-start gap-3">
            <span className="bg-brand-500/10 text-brand-700 grid size-10 shrink-0 place-items-center rounded-md">
              <CalendarClock className="size-4" />
            </span>
            <div>
              <p className="text-foreground text-[15px] font-semibold tracking-[-0.01em]">
                任务排程
              </p>
              <p className="text-muted-foreground mt-1 text-xs leading-5">
                设置任务的生效方式、目标对象与表单载荷；系统会自动生成待办。
              </p>
            </div>
            <div className="border-border/70 bg-muted/40 text-muted-foreground ml-auto inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium">
              <span className="text-foreground font-semibold">
                {taskTypeLabel}
              </span>
              <span className="bg-border size-1 rounded-full" />
              <span className="text-foreground font-semibold">
                {frequencyLabel}
              </span>
            </div>
          </div>

          <div className="mt-6 grid gap-5 xl:grid-cols-[minmax(0,1fr)_280px]">
            <div className="space-y-5">
              <section className="border-border/70 bg-muted/30 rounded-2xl border p-5">
                <div className="flex items-start gap-3">
                  <span className="bg-brand-500/15 font-display text-brand-700 grid size-7 place-items-center rounded-lg text-[11px] font-bold">
                    01
                  </span>
                  <div>
                    <p className="text-foreground text-sm font-semibold">
                      任务定义
                    </p>
                    <p className="text-muted-foreground mt-0.5 text-[11px]">
                      任务名称与提交载荷
                    </p>
                  </div>
                </div>
                <div className="mt-5 grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2 sm:col-span-2">
                    <Label>规则名称</Label>
                    <Input
                      value={name}
                      onChange={(event) => setName(event.target.value)}
                      placeholder="例如：每日思想汇报"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>任务类型</Label>
                    <Select
                      value={taskType}
                      onValueChange={(value) => {
                        setTaskType(value)
                        setTemplateId("")
                      }}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="REPORT">汇报类</SelectItem>
                        <SelectItem value="STUDY">学习类</SelectItem>
                        <SelectItem value="LABOR">劳动类</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>任务表单</Label>
                    <Select
                      value={templateId}
                      onValueChange={(value) =>
                        setTemplateId(value === "__none__" ? "" : value)
                      }
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="暂不绑定表单" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">暂不绑定表单</SelectItem>
                        {templates.data
                          ?.filter((template) => template.kind === taskType)
                          .map((template) => (
                            <SelectItem key={template.id} value={template.id}>
                              {template.name}（{template.kind}）
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </section>

              <section className="border-border/70 bg-muted/30 rounded-2xl border p-5">
                <div className="flex items-start gap-3">
                  <span className="bg-brand-500/15 font-display text-brand-700 grid size-7 place-items-center rounded-lg text-[11px] font-bold">
                    02
                  </span>
                  <div>
                    <p className="text-foreground text-sm font-semibold">
                      执行计划
                    </p>
                    <p className="text-muted-foreground mt-0.5 text-[11px]">
                      周期、时间与有效期
                    </p>
                  </div>
                </div>
                <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  <div className="space-y-2">
                    <Label>执行周期</Label>
                    <Select value={freq} onValueChange={setFreq}>
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="DAILY">每日</SelectItem>
                        <SelectItem value="WEEKLY">每周</SelectItem>
                        <SelectItem value="MONTHLY">每月</SelectItem>
                        <SelectItem value="ONCE">一次性</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>发出时间</Label>
                    <TimePicker value={slot} onValueChange={setSlot} />
                  </div>
                  <div className="space-y-2">
                    <Label>有效时长（分钟）</Label>
                    <Input
                      type="number"
                      min="1"
                      max="1440"
                      value={timeoutMinutes}
                      onChange={(event) =>
                        setTimeoutMinutes(Number(event.target.value))
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>
                      {freq === "ONCE" ? "发出日期" : "开始生效日期"}
                    </Label>
                    <DatePicker
                      ariaLabel={freq === "ONCE" ? "发出日期" : "开始生效日期"}
                      value={startDate}
                      onValueChange={setStartDate}
                    />
                  </div>
                </div>
                {freq !== "DAILY" && freq !== "ONCE" && (
                  <div key={freq} className="mt-5">
                    <Label>{freq === "WEEKLY" ? "生效星期" : "生效日期"}</Label>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {(freq === "WEEKLY"
                        ? weekDays
                        : Array.from(
                            { length: 31 },
                            (_, index) => `${index + 1}`,
                          )
                      ).map((label, index) => {
                        const v = index + 1
                        const selected = scheduleDays.includes(v)
                        return (
                          <button
                            key={label}
                            type="button"
                            aria-pressed={selected}
                            onClick={() =>
                              setScheduleDays((days) =>
                                selected
                                  ? days.filter((day) => day !== v)
                                  : [...days, v],
                              )
                            }
                            className={cn(
                              "inline-flex h-9 min-w-9 items-center justify-center rounded-lg border px-3 text-sm font-medium transition-all",
                              selected
                                ? "border-brand-500/60 from-brand-500 bg-gradient-to-br to-[color:var(--chart-5)] text-white shadow-[0_4px_12px_-4px_rgba(112,80,255,0.5)]"
                                : "border-border/70 bg-card text-muted-foreground hover:border-brand-500/50 hover:text-foreground",
                            )}
                          >
                            {label}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )}
              </section>

              <section className="border-border/70 bg-muted/30 rounded-2xl border p-5">
                <div className="flex items-start gap-3">
                  <span className="bg-brand-500/15 font-display text-brand-700 grid size-7 place-items-center rounded-lg text-[11px] font-bold">
                    03
                  </span>
                  <div>
                    <p className="text-foreground text-sm font-semibold">
                      执行范围
                    </p>
                    <p className="text-muted-foreground mt-0.5 text-[11px]">
                      可以归入规则组，也可以直接指定对象
                    </p>
                  </div>
                </div>
                <div className="mt-5 grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label>规则组</Label>
                    <Select
                      value={groupId}
                      onValueChange={(value) =>
                        setGroupId(value === "__none__" ? "" : value)
                      }
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="不归入规则组" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">不归入规则组</SelectItem>
                        {groups.data?.map((group) => (
                          <SelectItem key={group.id} value={group.id}>
                            {group.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>目标被监管人</Label>
                    <Select
                      value={userId}
                      onValueChange={(value) =>
                        setUserId(value === "__none__" ? "" : value)
                      }
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="由规则组范围决定" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">
                          由规则组范围决定
                        </SelectItem>
                        {supervised.map((user) => (
                          <SelectItem key={user.id} value={user.id}>
                            {user.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </section>
            </div>

            <aside aria-live="polite" className="space-y-4">
              <div
                key={`${slot}-${timeoutMinutes}`}
                className="schedule-preview overflow-hidden text-center"
              >
                <div className="from-brand-500 absolute inset-x-0 top-0 h-1 bg-gradient-to-r via-[color:var(--chart-5)] to-[color:var(--info)]" />
                <div className="relative space-y-3 pt-4">
                  <span className="from-brand-500/20 text-brand-700 mx-auto grid size-10 place-items-center rounded-xl bg-gradient-to-br to-[color:var(--chart-5)]/15">
                    <Clock3 className="size-4" />
                  </span>
                  <p className="text-muted-foreground text-[11px] font-semibold tracking-[0.16em] uppercase">
                    任务窗口
                  </p>
                  <p className="font-numeric text-foreground text-3xl font-bold tracking-tight">
                    {slot}
                  </p>
                  <div className="bg-border mx-auto h-px w-12" />
                  <p className="text-muted-foreground text-xs">
                    {deadlinePreview(slot, timeoutMinutes)}
                  </p>
                  <p className="text-muted-foreground/70 text-[10px]">
                    截止时间由发出时间与有效时长自动计算
                  </p>
                </div>
              </div>
              <div className="border-success/30 bg-success/10 text-success flex items-start gap-2 rounded-xl border px-3 py-2.5 text-[12px]">
                <CheckCircle2 className="mt-0.5 size-3.5 shrink-0" />
                <span>跨日无需额外配置，系统会准确落到次日截止。</span>
              </div>
              <div className="border-border/70 bg-card text-muted-foreground flex items-start gap-2 rounded-xl border px-3 py-2.5 text-[12px]">
                <FileText className="text-brand-700 mt-0.5 size-3.5 shrink-0" />
                <span>
                  {templateId ? "已绑定任务表单" : "未绑定表单，可稍后补充"}
                </span>
              </div>
              <div className="border-border/70 bg-card text-muted-foreground flex items-start gap-2 rounded-xl border px-3 py-2.5 text-[12px]">
                <UsersRound className="text-brand-700 mt-0.5 size-3.5 shrink-0" />
                <span>
                  {userId ? "将直接下发给指定人员" : "执行范围由规则组决定"}
                </span>
              </div>
              <Button
                variant="brand"
                className="w-full"
                disabled={!name || create.isPending}
                onClick={() => create.mutate()}
              >
                <Repeat2 />
                {create.isPending ? "正在创建…" : "创建任务规则"}
              </Button>
            </aside>
          </div>
        </CardContent>
      </Card>
      <Card className="page-enter shadow-soft border-0">
        <CardContent className="p-0">
          <div className="border-border/60 flex items-center justify-between border-b px-6 py-4">
            <div>
              <p className="text-foreground text-sm font-semibold">规则台账</p>
              <span className="text-muted-foreground mt-0.5 block text-[11px]">
                已创建的规则会在此持续展示执行配置
              </span>
            </div>
            <span className="bg-muted/60 text-muted-foreground rounded-full px-2.5 py-1 text-[11px] font-medium">
              {rules.data?.length ?? 0} 条
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[680px] text-sm">
              <thead className="text-muted-foreground text-left text-[11px] font-semibold tracking-[0.08em] uppercase">
                <tr>
                  <th className="px-6 py-3">规则</th>
                  <th className="px-6 py-3">周期</th>
                  <th className="px-6 py-3">排程</th>
                  <th className="px-6 py-3">范围</th>
                  <th className="px-6 py-3 text-right">操作</th>
                </tr>
              </thead>
              <tbody className="divide-border/60 divide-y">
                {rules.data?.map((rule) => (
                  <tr key={rule.id} className="hover:bg-muted/30">
                    <td className="px-6 py-4">
                      <p className="text-foreground font-medium">{rule.name}</p>
                      <Badge variant="brand" className="mt-1.5 text-[10px]">
                        {taskTypeLabels[
                          rule.type as keyof typeof taskTypeLabels
                        ] ?? rule.type}
                      </Badge>
                    </td>
                    <td className="text-muted-foreground px-6 py-4 font-mono text-xs">
                      {rule.freq}
                    </td>
                    <td className="font-numeric text-muted-foreground px-6 py-4 text-xs">
                      {rule.timeSlots[0] ?? "—"} 发出 ·{" "}
                      {deadlinePreview(
                        rule.timeSlots[0] ?? "00:00",
                        rule.timeoutMinutes,
                      )}
                    </td>
                    <td className="text-muted-foreground px-6 py-4">
                      {rule.scopes.length ? "规则指定" : "继承规则组"}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        className="text-muted-foreground hover:text-destructive"
                        onClick={() => remove.mutate(rule.id)}
                      >
                        <Trash2 />
                      </Button>
                    </td>
                  </tr>
                ))}
                {rules.data?.length === 0 && (
                  <tr>
                    <td colSpan={5} className="p-6">
                      <EmptyState
                        icon={CalendarClock}
                        title="还没有任务规则"
                        description="完成上方表单即可创建第一条规则。"
                      />
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
