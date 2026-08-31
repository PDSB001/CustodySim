"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  BookOpenCheck,
  ListChecks,
  Minus,
  Plus,
  ShieldAlert,
  Trophy,
} from "lucide-react"
import { useState } from "react"
import { z } from "zod"

import { formatDate, requestApi } from "@/components/shared/api-client"
import { EmptyState } from "@/components/shared/empty-state"
import { PageHeader } from "@/components/shared/page-header"
import { StatusPill } from "@/components/shared/status-pill"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { toast } from "@/components/ui/toast"

const ScoreEvent = z.object({
  id: z.string(),
  points: z.number(),
  reason: z.string(),
  source: z.string(),
  createdAt: z.string(),
})
const PersonScore = z.object({
  id: z.string(),
  name: z.string(),
  currentScore: z.number(),
  activeIsolation: z
    .object({
      id: z.string(),
      triggerScore: z.number(),
      startAt: z.string(),
      endAt: z.string(),
    })
    .nullable(),
  weeklyReview: z
    .object({
      result: z.string(),
      totalScore: z.number(),
      evaluatedAt: z.string(),
    })
    .nullable(),
  events: z.array(ScoreEvent),
  canViewDetails: z.boolean(),
})
const Scoreboard = z.object({
  selectedWeek: z.string(),
  currentWeek: z.string(),
  weeks: z.array(z.string()),
  people: z.array(PersonScore),
})
const SaveResult = z.object({ id: z.string() })

function weekLabel(weekKey: string) {
  const start = new Date(`${weekKey}T00:00:00+08:00`)
  const end = new Date(start.getTime() + 6 * 86_400_000)
  return `${start.getMonth() + 1}/${start.getDate()}–${end.getMonth() + 1}/${end.getDate()} 所在周`
}

const scoreSourceLabels: Record<string, string> = {
  CHECKIN_DAILY: "打卡日结",
  TASK_OUTCOME: "任务结果",
  MANUAL: "人工调整",
}

export function ScoreboardManage({
  canAdjust = false,
}: {
  canAdjust?: boolean
}) {
  const client = useQueryClient()
  const [week, setWeek] = useState<string | null>(null)
  const [rulesOpen, setRulesOpen] = useState(false)
  const [selected, setSelected] = useState<z.infer<typeof PersonScore> | null>(
    null,
  )
  const [detailPerson, setDetailPerson] = useState<z.infer<
    typeof PersonScore
  > | null>(null)
  const [points, setPoints] = useState("1")
  const [reason, setReason] = useState("")
  const scores = useQuery({
    queryKey: ["scoreboard", week],
    queryFn: () =>
      requestApi(
        `/api/scores${week ? `?week=${encodeURIComponent(week)}` : ""}`,
        Scoreboard,
      ),
  })
  const adjust = useMutation({
    mutationFn: () =>
      requestApi("/api/scores", SaveResult, {
        method: "POST",
        body: JSON.stringify({
          supervisedId: selected?.id,
          points: Number(points),
          reason,
        }),
      }),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["scoreboard"] })
      setSelected(null)
      setPoints("1")
      setReason("")
      toast.success("积分流水已记录")
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "积分调整失败"),
  })
  const data = scores.data
  const isCurrentWeek = data?.selectedWeek === data?.currentWeek

  return (
    <div className="workspace-stack">
      <PageHeader
        eyebrow="监管执行"
        title="积分排行与禁闭"
        description="全员可查看周积分排行；被监管人仅显示同监室全名，其余人员以脱敏姓名展示。"
        action={
          <Button variant="outline" onClick={() => setRulesOpen(true)}>
            <BookOpenCheck />
            积分计算规则
          </Button>
        }
      />
      <div className="grid gap-4 md:grid-cols-3">
        <Metric
          icon={Trophy}
          label="正积分人员"
          value={
            data?.people.filter((person) => person.currentScore > 0).length ?? 0
          }
          tone="brand"
        />
        <Metric
          icon={Minus}
          label="负积分人员"
          value={
            data?.people.filter((person) => person.currentScore < 0).length ?? 0
          }
          tone="warning"
        />
        <Metric
          icon={ShieldAlert}
          label="执行中禁闭"
          value={
            data?.people.filter((person) => person.activeIsolation).length ?? 0
          }
          tone="danger"
        />
      </div>
      <Card className="shadow-soft border-0">
        <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4 sm:p-5">
          <div>
            <p className="text-foreground text-sm font-semibold">周积分历史</p>
            <p className="text-muted-foreground mt-1 text-xs">
              {isCurrentWeek ? "正在累计本周积分" : "查看已归档周次的积分结果"}
            </p>
          </div>
          <Select value={data?.selectedWeek ?? ""} onValueChange={setWeek}>
            <SelectTrigger className="w-full sm:w-56">
              <SelectValue placeholder="选择周次" />
            </SelectTrigger>
            <SelectContent>
              {data?.weeks.map((item) => (
                <SelectItem key={item} value={item}>
                  {weekLabel(item)}
                  {item === data.currentWeek ? "（本周）" : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>
      <Card className="shadow-soft border-0">
        <CardContent className="overflow-x-auto p-0">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="bg-muted/40 text-muted-foreground text-[11px] font-semibold tracking-[0.08em] uppercase">
              <tr>
                <th className="px-5 py-3">排名</th>
                <th className="px-5 py-3">人员</th>
                <th className="px-5 py-3">周积分</th>
                <th className="px-5 py-3">周结状态</th>
                <th className="px-5 py-3">最近流水</th>
                <th className="px-5 py-3 text-right">操作</th>
              </tr>
            </thead>
            <tbody className="divide-border/60 divide-y">
              {data?.people.map((person, index) => (
                <tr key={person.id} className="hover:bg-muted/30">
                  <td className="font-numeric text-muted-foreground px-5 py-4">
                    #{index + 1}
                  </td>
                  <td className="px-5 py-4 font-medium">{person.name}</td>
                  <td
                    className={`px-5 py-4 text-lg font-semibold ${person.currentScore < 0 ? "text-destructive" : person.currentScore > 0 ? "text-success" : "text-muted-foreground"}`}
                  >
                    {person.currentScore > 0
                      ? `+${person.currentScore}`
                      : person.currentScore}
                  </td>
                  <td className="px-5 py-4">
                    {person.activeIsolation ? (
                      <StatusPill tone="danger">
                        禁闭至 {formatDate(person.activeIsolation.endAt)}
                      </StatusPill>
                    ) : person.weeklyReview ? (
                      <StatusPill
                        tone={
                          person.weeklyReview.result === "ISOLATION"
                            ? "danger"
                            : "success"
                        }
                      >
                        {person.weeklyReview.result === "ISOLATION"
                          ? "已触发禁闭"
                          : "周结正常"}
                      </StatusPill>
                    ) : (
                      <StatusPill tone="neutral">
                        {isCurrentWeek ? "累计中" : "未结算"}
                      </StatusPill>
                    )}
                  </td>
                  <td className="text-muted-foreground max-w-80 px-5 py-4">
                    <p className="truncate">
                      {person.events[0]
                        ? `${person.events[0].points > 0 ? "+" : ""}${person.events[0].points} · ${person.events[0].reason}`
                        : "—"}
                    </p>
                    {person.events[0] ? (
                      <p className="mt-1 text-xs">
                        {formatDate(person.events[0].createdAt)}
                      </p>
                    ) : null}
                  </td>
                  <td className="px-5 py-4">
                    <div className="flex justify-end gap-2">
                      {person.canViewDetails ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setDetailPerson(person)}
                        >
                          <ListChecks />
                          明细
                        </Button>
                      ) : null}
                      {canAdjust ? (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setSelected(person)}
                        >
                          <Plus />
                          调整
                        </Button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
              {data?.people.length === 0 ? (
                <tr>
                  <td colSpan={6} className="p-0">
                    <EmptyState
                      icon={Trophy}
                      title="暂无可计分人员"
                      description="建立被监管人员账户后，会显示在积分排行榜。"
                    />
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </CardContent>
      </Card>
      <Dialog open={rulesOpen} onOpenChange={setRulesOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>积分计算规则公示</DialogTitle>
          </DialogHeader>
          <div className="text-muted-foreground space-y-3 text-sm leading-6">
            <p>
              <strong className="text-foreground">打卡日结：</strong>
              有正常打卡时，5 分起算；每次补卡减 1 分、每次缺卡减 2 分，最低为 0
              分。全天没有正常打卡为 -8 分。
            </p>
            <p>
              <strong className="text-foreground">任务结果：</strong>
              首次按时通过 +2；打回后在截止前通过
              +1；截止时仍未通过、未提交或待审核 -2。评分不影响积分。
            </p>
            <p>
              <strong className="text-foreground">周结禁闭：</strong>
              上一自然周于周一 00:00 截止，系统等待日结完成后于 00:10
              起执行周结；周积分为负即进入 3 天禁闭，加强打卡并每日提交检讨。
            </p>
            <p>
              <strong className="text-foreground">请假：</strong>
              请假期间系统补卡与自动通过任务不参与行为积分。
            </p>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog
        open={Boolean(detailPerson)}
        onOpenChange={(open) => !open && setDetailPerson(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>积分明细 · {detailPerson?.name}</DialogTitle>
          </DialogHeader>
          <div className="text-muted-foreground text-sm">
            {data?.selectedWeek ? weekLabel(data.selectedWeek) : "所选周次"}
            ，合计{" "}
            <strong
              className={
                detailPerson && detailPerson.currentScore < 0
                  ? "text-destructive"
                  : "text-foreground"
              }
            >
              {detailPerson && detailPerson.currentScore > 0 ? "+" : ""}
              {detailPerson?.currentScore ?? 0}
            </strong>{" "}
            分
          </div>
          <div className="max-h-[55vh] space-y-2 overflow-y-auto pr-1">
            {detailPerson?.events.map((event) => (
              <div
                key={event.id}
                className="border-border/70 flex items-start justify-between gap-4 rounded-lg border p-3"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium">{event.reason}</p>
                  <p className="text-muted-foreground mt-1 text-xs">
                    {scoreSourceLabels[event.source] ?? "积分变动"} ·{" "}
                    {formatDate(event.createdAt)}
                  </p>
                </div>
                <span
                  className={`shrink-0 text-base font-semibold ${event.points < 0 ? "text-destructive" : "text-success"}`}
                >
                  {event.points > 0 ? "+" : ""}
                  {event.points}
                </span>
              </div>
            ))}
            {detailPerson?.events.length === 0 ? (
              <EmptyState
                icon={ListChecks}
                title="本周暂无积分明细"
                description="本周产生的加减分记录会显示在这里。"
              />
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
      {canAdjust ? (
        <Dialog
          open={Boolean(selected)}
          onOpenChange={(open) =>
            !open && !adjust.isPending && setSelected(null)
          }
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>调整积分 · {selected?.name}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-2">
                <Label>积分变动（-10 至 +10）</Label>
                <Input
                  type="number"
                  min="-10"
                  max="10"
                  value={points}
                  onChange={(event) => setPoints(event.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>调整原因</Label>
                <Textarea
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  placeholder="例如：主动协助完成公共事务"
                />
              </div>
              <Button
                className="w-full"
                variant="brand"
                disabled={!reason || !Number(points) || adjust.isPending}
                onClick={() => adjust.mutate()}
              >
                {adjust.isPending ? "记录中…" : "确认记录积分"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  )
}

function Metric({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: typeof Trophy
  label: string
  value: number
  tone: "brand" | "warning" | "danger"
}) {
  const styles = {
    brand: "bg-brand-500/10 text-brand-700",
    warning: "bg-warning/10 text-warning",
    danger: "bg-destructive/10 text-destructive",
  }[tone]
  return (
    <Card className="shadow-soft border-0">
      <CardContent className="flex items-center gap-3 p-5">
        <span
          className={`${styles} grid size-10 place-items-center rounded-xl`}
        >
          <Icon className="size-5" />
        </span>
        <div>
          <p className="text-muted-foreground text-xs">{label}</p>
          <p className="text-2xl font-semibold">{value}</p>
        </div>
      </CardContent>
    </Card>
  )
}
