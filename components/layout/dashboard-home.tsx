"use client"

import { useQuery } from "@tanstack/react-query"
import {
  ArrowRight,
  Building2,
  CalendarCheck2,
  CheckCircle2,
  ClipboardCheck,
  FileText,
  Settings2,
  ShieldCheck,
  TimerReset,
  UsersRound,
} from "lucide-react"
import Link from "next/link"
import { z } from "zod"

import { requestApi } from "@/components/shared/api-client"
import { MetricCell } from "@/components/shared/metric-cell"
import {
  ErrorState,
  LoadingBlock,
  QueryStateView,
} from "@/components/shared/query-state-view"
import { PageHeader } from "@/components/shared/page-header"
import { StatusPill } from "@/components/shared/status-pill"
import type { SessionUser } from "@/lib/session"

const DashboardSummary = z.object({
  pendingTasks: z.number(),
  pendingMakeups: z.number(),
  pendingCheckins: z.number(),
  myPendingTasks: z.number(),
  inCustodyPersons: z.number(),
  enabledRules: z.number(),
  custodyStatus: z.string(),
})

const quickActions = [
  {
    href: "/orgs",
    label: "维护组织架构",
    detail: "设置监管机构、监区与监室层级",
    icon: Building2,
  },
  {
    href: "/accounts",
    label: "管理账户权限",
    detail: "创建角色账户并分配组织归属",
    icon: UsersRound,
  },
  {
    href: "/rules",
    label: "配置任务规则",
    detail: "定义任务周期、表单载荷与执行范围",
    icon: ClipboardCheck,
  },
  {
    href: "/checkin-rules",
    label: "维护打卡方案",
    detail: "管理监管级别对应的打卡时段",
    icon: CalendarCheck2,
  },
]

const healthItems: Array<[string, string]> = [
  ["身份认证", "已启用"],
  ["权限隔离", "运行中"],
  ["审计留痕", "运行中"],
  ["精确定位清理", "3 天"],
]

export function DashboardHome({ user }: Readonly<{ user: SessionUser }>) {
  const summary = useQuery({
    queryKey: ["dashboard-summary"],
    queryFn: () => requestApi("/api/dashboard-summary", DashboardSummary),
  })
  const data = summary.data
  const pendingReviewCount =
    (data?.pendingTasks ?? 0) + (data?.pendingMakeups ?? 0)
  const primaryAction =
    pendingReviewCount > 0
      ? {
          href: data?.pendingTasks ? "/supervision/tasks" : "/supervision/makeups",
          title: `有 ${pendingReviewCount} 项事项等待处理`,
          description: "优先完成审核，避免任务与补卡申请积压。",
          action: "立即处理",
          icon: ClipboardCheck,
        }
      : (data?.enabledRules ?? 0) > 0
        ? {
            href: "/persons",
            title: "系统运行平稳",
            description: "下一步可维护人员档案并完善监管关系。",
            action: "维护人员档案",
            icon: UsersRound,
          }
        : {
            href: "/orgs",
            title: "从基础配置开始",
            description: "建议依次建立组织架构、账户权限和任务规则。",
            action: "维护组织架构",
            icon: Building2,
          }
  const PrimaryIcon = primaryAction.icon
  const summaries = [
    {
      label: "待审核任务",
      value: String(data?.pendingTasks ?? 0),
      detail: <span>{data?.pendingTasks ? "任务等待审核" : "暂无待审核任务"}</span>,
      icon: ClipboardCheck,
      tone: "brand" as const,
    },
    {
      label: "待审补卡",
      value: String(data?.pendingMakeups ?? 0),
      detail: <span>{data?.pendingMakeups ? "补卡申请待处理" : "审核队列为空"}</span>,
      icon: TimerReset,
      tone: "warning" as const,
    },
    {
      label: "在押人员",
      value: String(data?.inCustodyPersons ?? 0),
      detail: <span>当前在押统计</span>,
      icon: UsersRound,
      tone: "info" as const,
    },
    {
      label: "启用规则",
      value: String(data?.enabledRules ?? 0),
      detail: <span>正在执行的任务规则</span>,
      icon: FileText,
      tone: "success" as const,
    },
  ]

  return (
    <div className="workspace-stack mx-auto max-w-6xl">
      <PageHeader
        eyebrow="管理总览"
        title={
          <span>
            你好，<span className="text-gradient-brand">{user.name}</span>
          </span>
        }
        description="从组织、账户、规则到审计，集中维护监管任务系统的基础配置与运行边界。"
        action={
          <StatusPill tone="success">系统运行正常</StatusPill>
        }
      />

      <Link
        href={primaryAction.href}
        className="surface-panel surface-panel--brand group page-enter flex items-center gap-4 p-4 transition-colors hover:border-brand-500/40 sm:p-5"
      >
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-brand-500/12 text-brand-700">
          <PrimaryIcon className="size-5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-foreground">
            {primaryAction.title}
          </span>
          <span className="mt-1 block text-sm text-muted-foreground">
            {primaryAction.description}
          </span>
        </span>
        <span className="hidden items-center gap-1 text-sm font-medium text-brand-700 sm:inline-flex">
          {primaryAction.action}
          <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
        </span>
      </Link>

      <section className="metric-grid page-enter" aria-label="运行概览">
        <QueryStateView
          isLoading={summary.isLoading}
          error={summary.error}
          onRetry={() => summary.refetch()}
          loading={<LoadingBlock className="col-span-full h-32" />}
          errorFallback={<div className="col-span-full"><ErrorState onRetry={() => summary.refetch()} title="概览加载失败" description="运行指标暂不可用，刷新页面或稍后重试。" /></div>}
        >
          {summaries.map(({ label, value, detail, icon, tone }) => (
            <MetricCell
              key={label}
              label={label}
              value={value}
              detail={detail}
              icon={icon}
              tone={tone}
            />
          ))}
        </QueryStateView>
      </section>

      <section className="grid gap-4 page-enter lg:grid-cols-[minmax(0,1.35fr)_minmax(16rem,0.65fr)]">
        <div className="surface-panel overflow-hidden">
          <div className="surface-panel__head">
            <h2 className="surface-panel__title">
              <span className="glyph">
                <Settings2 className="size-3.5" />
              </span>
              继续配置
            </h2>
            <p className="surface-panel__sub">按推荐顺序完善系统基础数据</p>
          </div>
          <div className="divide-y divide-border/60">
            {quickActions.map(({ href, label, detail, icon: Icon }) => (
              <Link
                key={href}
                href={href}
                className="group flex items-center gap-3 px-5 py-3.5 transition-colors hover:bg-muted/50 sm:px-6"
              >
                <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground transition-colors group-hover:bg-brand-500/10 group-hover:text-brand-700">
                  <Icon className="size-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-foreground">
                    {label}
                  </span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    {detail}
                  </span>
                </span>
                <ArrowRight className="size-4 shrink-0 text-muted-foreground/60 transition-transform group-hover:translate-x-0.5 group-hover:text-brand-700" />
              </Link>
            ))}
          </div>
        </div>

        <div className="surface-panel surface-panel--brand p-4 sm:p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-foreground">
                安全与服务
              </h2>
              <p className="mt-1 text-xs text-muted-foreground">
                关键能力当前状态
              </p>
            </div>
            <span className="grid size-8 place-items-center rounded-lg bg-muted text-brand-700">
              <ShieldCheck className="size-4" />
            </span>
          </div>
          <div className="mt-4 space-y-2.5">
            {healthItems.map(([label, value]) => (
              <div
                key={label}
                className="flex items-center justify-between gap-3 border-b border-border/60 pb-2.5 text-xs last:border-0 last:pb-0"
              >
                <span className="text-muted-foreground">{label}</span>
                <span className="inline-flex items-center gap-1.5 font-medium text-foreground">
                  <CheckCircle2 className="size-3 text-success" />
                  {value}
                </span>
              </div>
            ))}
          </div>
          <Link
            href="/audit-logs"
            className="mt-5 inline-flex items-center gap-1 text-xs font-medium text-brand-700 transition-colors hover:text-brand-900"
          >
            查看操作审计
            <ArrowRight className="size-3.5" />
          </Link>
        </div>
      </section>
    </div>
  )
}
