"use client"

import { useQuery } from "@tanstack/react-query"
import type { LucideIcon } from "lucide-react"
import {
  AlertTriangle,
  ArrowRight,
  BellRing,
  Building2,
  CalendarCheck2,
  CheckCircle2,
  ClipboardCheck,
  ClipboardList,
  FileClock,
  FileText,
  Settings2,
  ShieldCheck,
  TimerReset,
  Trophy,
  UsersRound,
} from "lucide-react"
import Link from "next/link"
import type { ReactNode } from "react"
import { z } from "zod"

import { requestApi } from "@/components/shared/api-client"
import { MetricCell } from "@/components/shared/metric-cell"
import { PageHeader } from "@/components/shared/page-header"
import { LoadingBlock } from "@/components/shared/query-state-view"
import { StatusPill } from "@/components/shared/status-pill"
import { Button } from "@/components/ui/button"
import { DashboardSummarySchema } from "@/lib/dashboard-summary-schema"
import { getShanghaiDateKey } from "@/lib/shanghai-datetime"
import type { SessionUser } from "@/lib/session"

/**
 * 今日点名执行进度。
 * 复用既有只读接口 /api/supervision/checkins?date=YYYY-MM-DD
 * （与「点名记录」页同一数据源），不新增任何后端能力。
 */
const TodayExecutionSchema = z.array(
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

type TodayExecutionItem = z.infer<typeof TodayExecutionSchema>[number]

type MetricTone = "brand" | "info" | "success" | "warning" | "danger" | "neutral"

/** 快捷管理：原先占据首页第一视觉层级的监所设置入口，降级为页面底部的轻量入口。 */
const manageEntries = [
  { href: "/orgs", label: "组织架构", icon: Building2 },
  { href: "/accounts", label: "账户管理", icon: UsersRound },
  { href: "/rules", label: "任务编排", icon: FileText },
  { href: "/checkin-rules", label: "打卡规则", icon: CalendarCheck2 },
  { href: "/scores", label: "积分与禁闭", icon: Trophy },
]

function timeText(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value))
}

function executionState(item: TodayExecutionItem) {
  if (item.scheduledCount === 0)
    return { tone: "neutral" as const, label: "无打卡任务" }
  if (item.exceptionCount > 0)
    return { tone: "danger" as const, label: `异常 ${item.exceptionCount}` }
  if (item.pendingCount > 0)
    return { tone: "warning" as const, label: `待处理 ${item.pendingCount}` }
  return { tone: "success" as const, label: "已完成" }
}

/**
 * 顶部状态提示条。
 * 无待办时只留一条很矮的浅色状态行；有待办时才升级为黄色提醒条，
 * 避免"审核队列为空"也占掉整屏最高的视觉权重。
 */
function PendingStatusStrip({
  pendingTasks,
  pendingMakeups,
}: {
  pendingTasks: number
  pendingMakeups: number
}) {
  const total = pendingTasks + pendingMakeups

  if (total === 0)
    return (
      <div className="status-strip status-strip--calm page-enter">
        <CheckCircle2 className="status-strip__icon" />
        <span className="text-foreground/85 font-medium">
          当前暂无待审核任务或补卡
        </span>
        <span className="text-muted-foreground ml-auto text-xs">
          审核队列已清空
        </span>
      </div>
    )

  return (
    <div className="status-strip status-strip--alert page-enter">
      <AlertTriangle className="status-strip__icon" />
      <span className="text-foreground font-semibold">
        待处理事项 {total} 项
      </span>
      <span className="status-strip__breakdown">
        <Link href="/supervision/tasks" className="status-strip__item">
          任务审核
          <span className="status-strip__count">{pendingTasks}</span>
        </Link>
        <Link href="/supervision/makeups" className="status-strip__item">
          补卡审核
          <span className="status-strip__count">{pendingMakeups}</span>
        </Link>
      </span>
    </div>
  )
}

/** 今日执行：首页左侧主模块，回答"当班要执行什么"。 */
function TodayExecution() {
  const todayKey = getShanghaiDateKey()
  const execution = useQuery({
    queryKey: ["dashboard-today-execution", todayKey],
    queryFn: () =>
      requestApi(
        `/api/supervision/checkins?date=${encodeURIComponent(todayKey)}`,
        TodayExecutionSchema,
      ),
    // 执行进度不需要分钟级刷新，5 分钟足够，避免持续打这个聚合查询
    refetchInterval: 300_000,
  })
  const items = execution.data ?? []

  return (
    <div className="surface-panel overflow-hidden">
      <div className="surface-panel__head">
        <h2 className="surface-panel__title">
          <span className="glyph">
            <CalendarCheck2 className="size-3.5" />
          </span>
          今日执行
        </h2>
        <p className="surface-panel__sub">监所今日点名与报到执行进度</p>
      </div>

      {execution.isLoading ? (
        <div className="px-5 py-4 sm:px-6">
          <LoadingBlock rows={3} />
        </div>
      ) : execution.error ? (
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 sm:px-6">
          <p className="text-muted-foreground text-xs">
            今日执行情况暂不可用，请稍后重试。
          </p>
          <Button variant="outline" size="sm" onClick={() => execution.refetch()}>
            重新加载
          </Button>
        </div>
      ) : items.length === 0 ? (
        <p className="text-muted-foreground px-5 py-6 text-center text-xs sm:px-6">
          今日暂无点名与报到安排。
        </p>
      ) : (
        // 固定高度的内部滚动区：列出全部人员，由滚动条拖动查看，不再无限向下撑开页面
        <div className="divide-border/60 panel-scroll max-h-[21rem] divide-y">
          {items.map((item) => {
            const state = executionState(item)
            return (
              <Link
                key={item.supervisedId}
                href={`/supervision/checkins?date=${todayKey}`}
                className="group hover:bg-muted/50 flex items-center gap-3 px-5 py-2.5 transition-colors sm:px-6"
              >
                <span className="text-foreground min-w-0 flex-1 truncate text-sm font-medium">
                  {item.supervisedName}
                </span>
                <span className="font-numeric text-muted-foreground hidden shrink-0 text-xs sm:inline">
                  {item.latestCheckinAt
                    ? `最近 ${timeText(item.latestCheckinAt)}`
                    : "尚未打卡"}
                </span>
                <span className="font-numeric text-foreground/80 w-12 shrink-0 text-right text-xs">
                  {item.completedCount}/{item.scheduledCount}
                </span>
                <StatusPill tone={state.tone}>{state.label}</StatusPill>
              </Link>
            )
          })}
        </div>
      )}

      {items.length > 0 ? (
        <div className="border-border/60 border-t px-5 py-2.5 sm:px-6">
          <Link
            href={`/supervision/checkins?date=${todayKey}`}
            className="text-brand-700 hover:text-brand-900 inline-flex items-center gap-1 text-xs font-medium transition-colors"
          >
            查看点名记录
            <ArrowRight className="size-3.5" />
          </Link>
        </div>
      ) : null}
    </div>
  )
}

/**
 * 待处理事项：只展示已有入口与已有数据，带数量的才显示 Badge。
 * 数字只保留真正需要管理员「处理」的两类（任务审核、补卡审核）。
 */
function PendingQueue({
  pendingTasks,
  pendingMakeups,
}: {
  pendingTasks: number
  pendingMakeups: number
}) {
  const items: Array<{
    href: string
    label: string
    detail: string
    count?: number
    icon: LucideIcon
  }> = [
    {
      href: "/supervision/tasks",
      label: "任务审核",
      detail: "批阅在押人员呈报内容",
      count: pendingTasks,
      icon: ClipboardCheck,
    },
    {
      href: "/supervision/makeups",
      label: "补卡审核",
      detail: "核实漏点原因与补卡凭据",
      count: pendingMakeups,
      icon: TimerReset,
    },
    {
      href: "/applications",
      label: "申请审核",
      detail: "处理请假、申诉等申请",
      icon: ClipboardList,
    },
    {
      href: "/notices",
      label: "监所通知",
      detail: "发布通知与查阅发布记录",
      // 管理处是发布方而非受阅方，"未阅公示"不是管理员的待办，这里不出数字
      icon: BellRing,
    },
    {
      href: "/audit-logs",
      label: "操作审计",
      detail: "追溯系统关键操作记录",
      icon: FileClock,
    },
  ]
  const total = pendingTasks + pendingMakeups

  return (
    <div className="surface-panel overflow-hidden">
      <div className="surface-panel__head">
        <h2 className="surface-panel__title">
          <span className="glyph">
            <ShieldCheck className="size-3.5" />
          </span>
          待处理事项
        </h2>
        <p className="surface-panel__sub">
          {total > 0 ? `共 ${total} 项待审` : "当前无待审事项"}
        </p>
      </div>
      <div className="divide-border/60 divide-y">
        {items.map(({ href, label, detail, count, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className="group hover:bg-muted/50 flex items-center gap-3 px-5 py-2.5 transition-colors sm:px-6"
          >
            <span className="bg-muted text-muted-foreground group-hover:bg-brand-500/10 group-hover:text-brand-700 grid size-8 shrink-0 place-items-center rounded-lg transition-colors">
              <Icon className="size-4" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="text-foreground block text-sm font-medium">
                {label}
              </span>
              <span className="text-muted-foreground mt-0.5 block truncate text-xs">
                {detail}
              </span>
            </span>
            {typeof count === "number" && count > 0 ? (
              <StatusPill tone="warning">{count}</StatusPill>
            ) : null}
            <ArrowRight className="text-muted-foreground/60 group-hover:text-brand-700 size-4 shrink-0 transition-transform group-hover:translate-x-0.5" />
          </Link>
        ))}
      </div>
    </div>
  )
}

/** 快捷管理：设置在页面最下方，不再抢占当班工作的视觉中心。 */
function ManageShortcuts() {
  return (
    <div className="surface-panel overflow-hidden">
      <div className="surface-panel__head">
        <h2 className="surface-panel__title">
          <span className="glyph">
            <Settings2 className="size-3.5" />
          </span>
          快捷管理
        </h2>
        <p className="surface-panel__sub">监区、人员与每日执行规程</p>
      </div>
      <div className="grid gap-2 p-3 sm:grid-cols-2 xl:grid-cols-5">
        {manageEntries.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className="group border-border/60 hover:bg-muted/60 hover:border-brand-500/40 flex items-center gap-2.5 rounded-lg border px-3 py-2.5 transition-colors"
          >
            <span className="bg-muted text-muted-foreground group-hover:bg-brand-500/10 group-hover:text-brand-700 grid size-8 shrink-0 place-items-center rounded-lg transition-colors">
              <Icon className="size-4" />
            </span>
            <span className="text-foreground min-w-0 flex-1 truncate text-[13px] font-medium">
              {label}
            </span>
            <ArrowRight className="text-muted-foreground/60 group-hover:text-brand-700 size-3.5 shrink-0 transition-transform group-hover:translate-x-0.5" />
          </Link>
        ))}
      </div>
    </div>
  )
}

export function DashboardHome({ user }: Readonly<{ user: SessionUser }>) {
  const summary = useQuery({
    queryKey: ["dashboard-summary"],
    queryFn: () => requestApi("/api/dashboard-summary", DashboardSummarySchema),
    refetchInterval: 30_000,
  })
  const data = summary.data
  const pendingTasks = data?.pendingTasks ?? 0
  const pendingMakeups = data?.pendingMakeups ?? 0

  const summaries: Array<{
    label: string
    value: string
    detail: ReactNode
    icon: LucideIcon
    tone: MetricTone
  }> = [
    {
      label: "待审核任务",
      value: String(pendingTasks),
      detail: (
        <StatusPill tone={pendingTasks > 0 ? "warning" : "neutral"}>
          {pendingTasks > 0 ? "等待审核" : "暂无待审核"}
        </StatusPill>
      ),
      icon: ClipboardCheck,
      // 待处理类：>0 才用黄色强调，0 时退回中性，避免"没事也报警"
      tone: pendingTasks > 0 ? "warning" : "neutral",
    },
    {
      label: "待审补卡",
      value: String(pendingMakeups),
      detail: (
        <StatusPill tone={pendingMakeups > 0 ? "warning" : "neutral"}>
          {pendingMakeups > 0 ? "等待审核" : "审核队列为空"}
        </StatusPill>
      ),
      icon: TimerReset,
      tone: pendingMakeups > 0 ? "warning" : "neutral",
    },
    {
      label: "在押人员",
      value: String(data?.inCustodyPersons ?? 0),
      detail: <span className="text-muted-foreground">当前在押人员总数</span>,
      icon: UsersRound,
      tone: "brand",
    },
    {
      label: "启用规则",
      value: String(data?.enabledRules ?? 0),
      detail: <span className="text-muted-foreground">正在执行的任务规则</span>,
      icon: FileText,
      tone: "success",
    },
  ]

  return (
    <div className="workspace-stack">
      <PageHeader
        eyebrow="管理处 · 监所总览"
        title={
          <span>
            <span className="text-gradient-brand">{user.name}</span>，当班总览
          </span>
        }
        description="先处理呈报与补卡，再核对点名、纪律和在押档案。"
        alignActionWithTitle
        action={<StatusPill tone="neutral">监所管理</StatusPill>}
      />

      {/* 提示条依赖待办数量，加载完成后再渲染，避免先用占位数字误报 */}
      {data && !summary.error ? (
        <PendingStatusStrip
          pendingTasks={pendingTasks}
          pendingMakeups={pendingMakeups}
        />
      ) : null}

      <section className="metric-grid page-enter" aria-label="运行概览">
        {summary.isLoading ? (
          <LoadingBlock className="col-span-full h-24" />
        ) : summary.error ? (
          <div className="col-span-full">
            <div className="surface-panel flex flex-wrap items-center justify-between gap-3 px-5 py-4">
              <p className="text-muted-foreground text-xs">
                运行指标暂不可用，请刷新页面或稍后重试。
              </p>
              <Button variant="outline" size="sm" onClick={() => summary.refetch()}>
                重新加载
              </Button>
            </div>
          </div>
        ) : (
          summaries.map(({ label, value, detail, icon, tone }) => (
            <MetricCell
              key={label}
              label={label}
              value={value}
              detail={detail}
              icon={icon}
              tone={tone}
            />
          ))
        )}
      </section>

      {/* 当班工作区：左侧今日执行（主区），右侧待处理事项 */}
      <section className="page-enter grid items-start gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(17rem,1fr)]">
        <TodayExecution />
        <PendingQueue
          pendingTasks={pendingTasks}
          pendingMakeups={pendingMakeups}
        />
      </section>

      {/* 设置类入口降到页面底部，不再占据首页第一视觉层级 */}
      <ManageShortcuts />
    </div>
  )
}
