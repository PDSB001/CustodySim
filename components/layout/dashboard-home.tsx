"use client"

import { useQuery } from "@tanstack/react-query"
import {
  ArrowRight,
  Building2,
  CalendarCheck2,
  ClipboardCheck,
  FileText,
  Settings2,
  ShieldCheck,
  TimerReset,
  UsersRound,
} from "lucide-react"
import Link from "next/link"

import { requestApi } from "@/components/shared/api-client"
import { MetricCell } from "@/components/shared/metric-cell"
import {
  ErrorState,
  LoadingBlock,
  QueryStateView,
} from "@/components/shared/query-state-view"
import { PageHeader } from "@/components/shared/page-header"
import { StatusPill } from "@/components/shared/status-pill"
import { DashboardSummarySchema } from "@/lib/dashboard-summary-schema"
import type { SessionUser } from "@/lib/session"

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
    detail: "规定执行周期、呈报内容与适用人员",
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
  ["积分与禁闭", "/scores"],
  ["申请审核", "/applications"],
  ["监所通知", "/notices"],
  ["操作审计", "/audit-logs"],
]

export function DashboardHome({ user }: Readonly<{ user: SessionUser }>) {
  const summary = useQuery({
    queryKey: ["dashboard-summary"],
    queryFn: () =>
      requestApi("/api/dashboard-summary", DashboardSummarySchema),
    refetchInterval: 30_000,
  })
  const data = summary.data
  const pendingReviewCount =
    (data?.pendingTasks ?? 0) + (data?.pendingMakeups ?? 0)
  const primaryAction =
    pendingReviewCount > 0
      ? {
          href: data?.pendingTasks
            ? "/supervision/tasks"
            : "/supervision/makeups",
          title: `有 ${pendingReviewCount} 项事项等待处理`,
          description: "优先完成审核，避免任务与补卡申请积压。",
          action: "立即处理",
          icon: ClipboardCheck,
        }
      : (data?.enabledRules ?? 0) > 0
        ? {
            href: "/supervision/checkins",
            title: "任务与补卡暂无待审",
            description: "查看当日点名记录，核对在押人员执行情况。",
            action: "查看点名记录",
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
      detail: (
        <span>{data?.pendingTasks ? "任务等待审核" : "暂无待审核任务"}</span>
      ),
      icon: ClipboardCheck,
      tone: "brand" as const,
    },
    {
      label: "待审补卡",
      value: String(data?.pendingMakeups ?? 0),
      detail: (
        <span>{data?.pendingMakeups ? "补卡申请待处理" : "审核队列为空"}</span>
      ),
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
        eyebrow="管理处 · 监所总览"
        title={
          <span>
            <span className="text-gradient-brand">{user.name}</span>，当班总览
          </span>
        }
        description="先处理呈报与补卡，再核对点名、纪律和在押档案。"
        action={<StatusPill tone="neutral">监所管理</StatusPill>}
      />

      {data && !summary.error ? (
        <Link
          href={primaryAction.href}
          className="surface-panel surface-panel--brand priority-action group page-enter"
        >
          <span className="bg-brand-500/12 text-brand-700 grid size-10 shrink-0 place-items-center rounded-xl">
            <PrimaryIcon className="size-5" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="text-foreground block text-sm font-semibold">
              {primaryAction.title}
            </span>
            <span className="text-muted-foreground mt-1 block text-sm">
              {primaryAction.description}
            </span>
          </span>
          <span className="priority-action__cta">
            {primaryAction.action}
            <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
          </span>
        </Link>
      ) : null}

      <section className="metric-grid page-enter" aria-label="运行概览">
        <QueryStateView
          isLoading={summary.isLoading}
          error={summary.error}
          onRetry={() => summary.refetch()}
          loading={<LoadingBlock className="col-span-full h-32" />}
          errorFallback={
            <div className="col-span-full">
              <ErrorState
                onRetry={() => summary.refetch()}
                title="概览加载失败"
                description="运行指标暂不可用，刷新页面或稍后重试。"
              />
            </div>
          }
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

      <section className="page-enter grid gap-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(16rem,0.65fr)]">
        <div className="surface-panel overflow-hidden">
          <div className="surface-panel__head">
            <h2 className="surface-panel__title">
              <span className="glyph">
                <Settings2 className="size-3.5" />
              </span>
              监所设置
            </h2>
            <p className="surface-panel__sub">监区、人员与每日执行规程</p>
          </div>
          <div className="divide-border/60 divide-y">
            {quickActions.map(({ href, label, detail, icon: Icon }) => (
              <Link
                key={href}
                href={href}
                className="group hover:bg-muted/50 flex items-center gap-3 px-5 py-3.5 transition-colors sm:px-6"
              >
                <span className="bg-muted text-muted-foreground group-hover:bg-brand-500/10 group-hover:text-brand-700 grid size-8 shrink-0 place-items-center rounded-lg transition-colors">
                  <Icon className="size-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="text-foreground block text-sm font-medium">
                    {label}
                  </span>
                  <span className="text-muted-foreground mt-0.5 block text-xs">
                    {detail}
                  </span>
                </span>
                <ArrowRight className="text-muted-foreground/60 group-hover:text-brand-700 size-4 shrink-0 transition-transform group-hover:translate-x-0.5" />
              </Link>
            ))}
          </div>
        </div>

        <div className="surface-panel surface-panel--brand order-first p-4 sm:p-5 lg:order-last">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-foreground text-sm font-semibold">
                值班事务
              </h2>
              <p className="text-muted-foreground mt-1 text-xs">
                纪律处置、申请与文书记录
              </p>
            </div>
            <span className="bg-muted text-brand-700 grid size-8 place-items-center rounded-lg">
              <ShieldCheck className="size-4" />
            </span>
          </div>
          <div className="mt-4 space-y-2.5">
            {healthItems.map(([label, value]) => (
              <Link
                href={value}
                key={label}
                className="border-border/60 flex items-center justify-between gap-3 border-b pb-2.5 text-xs last:border-0 last:pb-0"
              >
                <span className="text-muted-foreground">{label}</span>
                <span className="text-foreground inline-flex items-center gap-1.5 font-medium">
                  <ArrowRight className="size-4" />
                </span>
              </Link>
            ))}
          </div>
          <Link
            href="/audit-logs"
            className="text-brand-700 hover:text-brand-900 mt-5 inline-flex items-center gap-1 text-xs font-medium transition-colors"
          >
            查看操作审计
            <ArrowRight className="size-3.5" />
          </Link>
        </div>
      </section>
    </div>
  )
}
