"use client"

import { useQuery } from "@tanstack/react-query"
import {
  ArrowRight,
  BellRing,
  Building2,
  CalendarCheck2,
  CalendarRange,
  ClipboardCheck,
  FileText,
  Hash,
  Inbox,
  TimerReset,
  UserRound,
  UsersRound,
} from "lucide-react"
import Link from "next/link"
import { z } from "zod"

import { CheckinHomeCard } from "@/components/checkin/checkin-home-card"
import { requestApi } from "@/components/shared/api-client"
import { EmptyState } from "@/components/shared/empty-state"
import { MetricCell } from "@/components/shared/metric-cell"
import { PageHeader } from "@/components/shared/page-header"
import {
  ErrorState,
  LoadingBlock,
  QueryStateView,
} from "@/components/shared/query-state-view"
import { StatusPill } from "@/components/shared/status-pill"
import { DashboardSummarySchema } from "@/lib/dashboard-summary-schema"
import type { SessionUser } from "@/lib/session"

type WorkspaceKind = "SUPERVISOR" | "SUPERVISED"

const UiConfigSchema = z.object({
  scope: z.string(),
  homeTitle: z.string(),
  homeSubtitle: z.string(),
  homeBanner: z.string(),
})

const ProfileSummarySchema = z.object({
  number: z.string().nullable(),
  organizationPath: z.string().nullable(),
  custodyLevel: z.string(),
  custodyLevelLabel: z.string(),
  chargeName: z.object({
    value: z.string().nullable(),
    source: z.enum(["PERSON", "ARCHIVE", "NONE"]),
  }),
  sentenceStartDate: z.object({
    value: z.string().nullable(),
    source: z.enum(["PERSON", "ARCHIVE", "NONE"]),
  }),
  sentenceEndDate: z.object({
    value: z.string().nullable(),
    source: z.enum(["PERSON", "ARCHIVE", "NONE"]),
  }),
})

const RoommateSummarySchema = z.object({
  roomName: z.string().nullable(),
  roommates: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      number: z.string().nullable(),
      custodyLevelLabel: z.string(),
      custodyStatusLabel: z.string(),
    }),
  ),
})

const homeContent = {
  SUPERVISOR: {
    eyebrow: "值班室 · 监管执勤",
    tone: "info" as const,
    toneLabel: "值班监管员",
    cards: [
      {
        id: "pendingTasks",
        label: "待批呈报",
        value: "0",
        detail: <span>在押人员呈报</span>,
        icon: ClipboardCheck,
        tone: "brand" as const,
      },
      {
        id: "pendingMakeups",
        label: "补点申请",
        value: "0",
        detail: <span>待核准</span>,
        icon: TimerReset,
        tone: "warning" as const,
      },
      {
        id: "unreadNotices",
        label: "未阅公示",
        value: "0",
        detail: <span>待阅的监所公示</span>,
        icon: BellRing,
        tone: "danger" as const,
      },
    ],
  },
  SUPERVISED: {
    eyebrow: "监室 · 每日执行",
    tone: "success" as const,
    toneLabel: "模拟服刑",
    cards: [
      {
        id: "myPendingTasks",
        label: "待呈报任务",
        value: "0",
        detail: <span>尚未呈报的任务</span>,
        icon: ClipboardCheck,
        // 待处理类：黄色代表"待处理"，为 0 时由 metricTone 退回中性
        tone: "warning" as const,
      },
      {
        id: "unreadNotices",
        label: "未阅公示",
        value: "0",
        detail: <span>待阅的监所公示</span>,
        icon: BellRing,
        tone: "info" as const,
      },
      {
        id: "custodyStatus",
        label: "在押情形",
        value: "正常",
        detail: <span>以在押档案为准</span>,
        icon: UserRound,
        tone: "success" as const,
      },
    ],
  },
} as const

type MetricTone = "brand" | "info" | "success" | "warning" | "danger" | "neutral"

/**
 * 数值型指标为 0 时退回中性色，避免"没有待办也保持高亮"；
 * 非数值状态（例如在押情形）保留其语义色。
 */
function metricTone(id: string, fallback: MetricTone, value: string) {
  const numeric = Number(value)
  if (id === "custodyStatus" || !Number.isFinite(numeric)) return fallback
  return numeric > 0 ? fallback : "neutral"
}

const serviceLinks = {
  SUPERVISOR: [
    {
      href: "/supervisor/tasks",
      label: "呈报批阅",
      detail: "核对呈报内容并给出批阅意见",
      icon: ClipboardCheck,
    },
    {
      href: "/supervisor/checkins",
      label: "点名总览",
      detail: "查看本班点名记录",
      icon: CalendarCheck2,
    },
    {
      href: "/supervisor/makeups",
      label: "补点核准",
      detail: "核实漏点原因与补点凭据",
      icon: TimerReset,
    },
    {
      href: "/supervisor/reports",
      label: "执勤台账",
      detail: "查看与提交执勤记录",
      icon: FileText,
    },
  ],
  SUPERVISED: [
    {
      href: "/my/tasks",
      label: "服刑任务",
      detail: "完成指定内容并呈报监管员批阅",
      icon: ClipboardCheck,
    },
    {
      href: "/my/checkins",
      label: "点名",
      detail: "查看点名时段与补点情况",
      icon: CalendarCheck2,
    },
    {
      href: "/my/notices",
      label: "监所公示",
      detail: "查阅监所公示与令行要求",
      icon: BellRing,
    },
    {
      href: "/my/profile",
      label: "在押档案",
      detail: "查看在押情形与身份信息",
      icon: UserRound,
    },
  ],
} as const

function ServiceLinks({ kind }: { kind: WorkspaceKind }) {
  return (
    <div className="surface-panel overflow-hidden">
      {/* 快捷事务入口：glyph 改为中性，避免与"当前任务"抢视觉层级 */}
      <div className="surface-panel__head">
        <h2 className="surface-panel__title">
          <span className="glyph bg-muted text-muted-foreground">
            <ArrowRight className="size-3.5" />
          </span>
          {kind === "SUPERVISOR" ? "执勤入口" : "监室事务"}
        </h2>
        <p className="surface-panel__sub">
          {kind === "SUPERVISOR"
            ? "批阅呈报、核准补点与执勤记录"
            : "呈报任务、查阅公示与在押档案"}
        </p>
      </div>
      <div className="divide-border/60 divide-y">
        {serviceLinks[kind].map(({ href, label, detail, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className="group hover:bg-muted/50 flex items-center gap-3 px-5 py-2.5 transition-colors sm:px-6"
          >
            <span className="bg-muted text-muted-foreground group-hover:bg-brand-500/10 group-hover:text-brand-700 grid size-8 shrink-0 place-items-center rounded-lg transition-colors">
              <Icon className="size-4" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="text-foreground block text-[13px] font-medium">
                {label}
              </span>
              <span className="text-muted-foreground mt-0.5 block truncate text-xs">
                {detail}
              </span>
            </span>
            <ArrowRight className="text-muted-foreground/60 group-hover:text-brand-700 size-4 shrink-0 transition-transform group-hover:translate-x-0.5" />
          </Link>
        ))}
      </div>
    </div>
  )
}

function ProfileSummaryCard() {
  const summary = useQuery({
    queryKey: ["my-profile-summary"],
    queryFn: () => requestApi("/api/my/profile-summary", ProfileSummarySchema),
  })
  const data = summary.data
  const sentence =
    data?.sentenceStartDate.value || data?.sentenceEndDate.value
      ? `${data.sentenceStartDate.value ?? "待完善"} 至 ${data.sentenceEndDate.value ?? "待完善"}`
      : "待从档案同步"
  const archiveLinked = [
    data?.chargeName,
    data?.sentenceStartDate,
    data?.sentenceEndDate,
  ].some((field) => field?.source === "ARCHIVE")
  const fields = [
    { label: "人员编号", value: data?.number ?? "待分配", icon: Hash },
    {
      label: "所属监室",
      value: data?.organizationPath ?? "待分配监室",
      icon: Building2,
    },
    {
      label: "监管级别",
      value: data?.custodyLevelLabel ?? "待配置",
      icon: UserRound,
    },
    {
      label: "罪名",
      value: data?.chargeName.value ?? "待从档案同步",
      icon: FileText,
    },
    { label: "刑期起止", value: sentence, icon: CalendarRange },
  ]
  if (summary.isLoading)
    return <LoadingBlock className="motion-item" rows={3} />
  if (summary.error)
    return (
      <div className="surface-panel motion-item">
        <ErrorState
          onRetry={() => summary.refetch()}
          title="我的监管信息加载失败"
          description="编号、监室、刑期等档案摘要暂不可用，请稍后重试。"
        />
      </div>
    )

  return (
    <section
      className="surface-panel page-enter overflow-hidden"
      aria-label="我的监管信息"
    >
      <div className="surface-panel__head">
        <h2 className="surface-panel__title">
          <span className="glyph">
            <UserRound className="size-3.5" />
          </span>
          在押档案摘要
        </h2>
        <p className="surface-panel__sub">编号、监室与档案摘要</p>
      </div>
      <div className="divide-border/60 grid divide-y sm:grid-cols-2 sm:divide-x sm:divide-y-0 lg:grid-cols-8">
        {fields.map(({ label, value, icon: Icon }) => (
          <div
            key={label}
            className={`min-w-0 px-5 py-4 sm:px-6 lg:px-5 ${label === "人员编号" || label === "所属监室" || label === "刑期起止" ? "lg:col-span-2" : ""}`}
          >
            <div className="text-muted-foreground flex items-center gap-1.5 text-xs font-medium">
              <Icon className="size-3.5" />
              {label}
            </div>
            <p
              className="text-foreground mt-2 text-sm leading-5 font-semibold break-words"
              title={value}
            >
              {value}
            </p>
          </div>
        ))}
      </div>
      {archiveLinked ? (
        <p className="border-border/60 text-muted-foreground border-t px-5 py-2.5 text-xs sm:px-6">
          部分信息取自在押档案。如与在押情形不符，请向管理处申请核对。
        </p>
      ) : null}
    </section>
  )
}

function RoommateSummaryCard() {
  const summary = useQuery({
    queryKey: ["my-roommates"],
    queryFn: () => requestApi("/api/my/roommates", RoommateSummarySchema),
  })
  const data = summary.data
  if (summary.isLoading)
    return <LoadingBlock className="motion-item" rows={3} />
  if (summary.error)
    return (
      <div className="surface-panel motion-item">
        <ErrorState
          onRetry={() => summary.refetch()}
          title="同监室人员加载失败"
          description="同监室人员列表暂不可用，请稍后重试。"
        />
      </div>
    )

  return (
    <section
      className="surface-panel page-enter overflow-hidden"
      aria-label="同监室人员"
    >
      <div className="surface-panel__head flex-row items-center justify-between gap-3">
        <div>
          <h2 className="surface-panel__title">
            <span className="glyph">
              <UsersRound className="size-3.5" />
            </span>
            同监室人员
          </h2>
          <p className="surface-panel__sub">
            {data?.roomName ? `${data.roomName} · 除本人外` : "尚未分配监室"}
          </p>
        </div>
        <StatusPill tone="info">{data?.roommates.length ?? 0} 人</StatusPill>
      </div>
      {data?.roommates.length ? (
        <div className="divide-border/60 grid divide-y sm:grid-cols-2 sm:divide-x sm:divide-y-0 lg:grid-cols-3">
          {data.roommates.map((roommate) => (
            <div key={roommate.id} className="min-w-0 px-5 py-3.5 sm:px-6">
              <div className="flex items-center justify-between gap-3">
                <p className="text-foreground truncate text-sm font-semibold">
                  {roommate.name}
                </p>
                <span className="text-brand-700 shrink-0 text-xs font-medium">
                  {roommate.custodyLevelLabel}
                </span>
              </div>
              <p className="text-muted-foreground mt-1 truncate text-xs">
                {roommate.number ?? "编号待分配"} ·{" "}
                {roommate.custodyStatusLabel}
              </p>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-muted-foreground px-5 py-6 text-sm sm:px-6">
          {data?.roomName
            ? "当前监室暂无其他在管人员。"
            : "管理处尚未为你分配具体监室。"}
        </p>
      )}
    </section>
  )
}

export function RoleWorkspaceHome({
  user,
  kind,
}: {
  user: SessionUser
  kind: WorkspaceKind
}) {
  const content = homeContent[kind]
  const uiConfig = useQuery({
    queryKey: ["ui-config", kind],
    queryFn: () => requestApi(`/api/ui-config?scope=${kind}`, UiConfigSchema),
    staleTime: 60_000,
  })
  const summary = useQuery({
    queryKey: ["dashboard-summary"],
    queryFn: () => requestApi("/api/dashboard-summary", DashboardSummarySchema),
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  })
  const pendingReviewCount =
    (summary.data?.pendingTasks ?? 0) + (summary.data?.pendingMakeups ?? 0)

  /*
   * 实时数值按卡片的稳定 id 取值。
   * 不要改回按 label（中文标题）取：文案随时会调整，一旦标题改动而这里没跟上，
   * 首页指标会静默退回硬编码的占位值，且编译器与测试都发现不了。
   */
  const dynamicValues: Record<string, string> =
    kind === "SUPERVISOR"
      ? {
          pendingTasks: String(summary.data?.pendingTasks ?? 0),
          pendingMakeups: String(summary.data?.pendingMakeups ?? 0),
          unreadNotices: String(summary.data?.unreadNotices ?? 0),
        }
      : {
          myPendingTasks: String(summary.data?.myPendingTasks ?? 0),
          unreadNotices: String(summary.data?.unreadNotices ?? 0),
          custodyStatus: summary.data?.custodyStatus ?? "待核实",
        }
  const homeTitle = (
    uiConfig.data?.homeTitle ??
    (kind === "SUPERVISOR" ? "{name}，当班执勤" : "{name}，监室日程")
  ).replace("{name}", user.name)
  const homeSubtitle =
    uiConfig.data?.homeSubtitle ??
    (kind === "SUPERVISOR"
      ? "先批阅任务与补卡，再核对点名记录，落实本班监管事项。"
      : "按时点名，完成指定任务；留意批阅意见与监所通知。")

  return (
    <div className="workspace-stack mx-auto max-w-5xl">
      <PageHeader
        eyebrow={content.eyebrow}
        title={
          <span>
            <span className="text-gradient-brand">{homeTitle}</span>
          </span>
        }
        description={homeSubtitle}
        alignActionWithTitle
        action={
          <StatusPill tone={content.tone}>{content.toneLabel}</StatusPill>
        }
      />

      {/*
        这里刻意不再放"还有 N 项任务待呈报"整行提醒卡：
        该数量已在下方统计卡「待呈报任务」中呈现，同一屏说两遍属于信息重复。
        待遇到"临近截止/已逾期/异常"这类需要立即处理的情形，
        再由数据层提供字段后升级为提醒条，不在前端凭空造判断。
      */}

      <section className="metric-grid page-enter" aria-label="今日概览">
        <QueryStateView
          isLoading={summary.isLoading}
          error={summary.error}
          onRetry={() => summary.refetch()}
          loading={<LoadingBlock className="col-span-full h-32" />}
          errorFallback={
            <div className="col-span-full">
              <ErrorState
                onRetry={() => summary.refetch()}
                title="今日概览加载失败"
                description="任务/打卡数量暂不可用，请稍后重试。"
              />
            </div>
          }
        >
          {content.cards.map(({ id, label, value, detail, icon, tone }) => {
            const displayValue = dynamicValues[id] ?? value
            return (
              <MetricCell
                key={id}
                label={label}
                value={displayValue}
                detail={detail}
                icon={icon}
                tone={
                  kind === "SUPERVISED"
                    ? metricTone(id, tone, displayValue)
                    : tone
                }
              />
            )
          })}
        </QueryStateView>
      </section>

      {kind === "SUPERVISOR" ? (
        <section className="page-enter grid gap-4 lg:grid-cols-[minmax(0,1.25fr)_minmax(16rem,0.75fr)]">
          <div className="surface-panel">
            <div className="surface-panel__head">
              <h2 className="surface-panel__title">
                <span className="glyph">
                  <Inbox className="size-3.5" />
                </span>
                本班审核
              </h2>
              <p className="surface-panel__sub">
                {pendingReviewCount > 0
                  ? `共 ${pendingReviewCount} 项待处理`
                  : "当前监管范围内的待审事项"}
              </p>
            </div>
            <QueryStateView
              isLoading={summary.isLoading}
              error={summary.error}
              onRetry={() => summary.refetch()}
              loading={<LoadingBlock rows={2} />}
            >
              <div className="divide-border/60 divide-y">
                {[
                  {
                    href: "/supervisor/tasks",
                    label: "呈报批阅",
                    count: summary.data?.pendingTasks,
                    detail: "核对呈报内容，给出批阅意见",
                  },
                  {
                    href: "/supervisor/makeups",
                    label: "补点核准",
                    count: summary.data?.pendingMakeups,
                    detail: "核实漏点原因与补点凭据",
                  },
                ].map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    className="hover:bg-muted/50 flex items-center gap-3 px-5 py-5"
                  >
                    <span className="flex-1">
                      <span className="block text-sm font-semibold">
                        {item.label}
                      </span>
                      <span className="text-muted-foreground mt-1 block text-xs">
                        {item.detail}
                      </span>
                    </span>
                    <StatusPill tone={item.count ? "warning" : "neutral"}>
                      {item.count ?? 0} 项待审
                    </StatusPill>
                    <ArrowRight className="text-muted-foreground size-4" />
                  </Link>
                ))}
              </div>
            </QueryStateView>
          </div>
          <ServiceLinks kind={kind} />
        </section>
      ) : (
        <section className="page-enter grid items-start gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(16rem,1fr)]">
          <div className="surface-panel">
            <div className="surface-panel__head">
              <h2 className="surface-panel__title">
                <span className="glyph">
                  <CalendarCheck2 className="size-3.5" />
                </span>
                今日点名 · 打卡
              </h2>
              <div className="flex items-center gap-3">
                <p className="surface-panel__sub">
                  按规定时段报到，漏点需申请补卡
                </p>
                {/* 次级操作：仅文字链接，权重低于当前任务、截止时间与主按钮 */}
                <Link
                  href="/my/checkins"
                  className="text-muted-foreground hover:text-brand-700 inline-flex shrink-0 items-center gap-0.5 text-xs font-medium transition-colors"
                >
                  查看记录
                  <ArrowRight className="size-3" />
                </Link>
              </div>
            </div>
            <div className="surface-panel__body">
              <CheckinHomeCard />
            </div>
          </div>
          <ServiceLinks kind={kind} />
        </section>
      )}
      {kind === "SUPERVISED" ? <ProfileSummaryCard /> : null}
      {kind === "SUPERVISED" ? <RoommateSummaryCard /> : null}
    </div>
  )
}

export function RoleWorkspacePlaceholder({
  kind,
  title,
}: {
  kind: WorkspaceKind
  title: string
}) {
  return (
    <div className="workspace-stack mx-auto max-w-5xl">
      <PageHeader
        eyebrow={kind === "SUPERVISOR" ? "监管执行" : "在押事务"}
        title={title}
        description={
          kind === "SUPERVISOR"
            ? "查阅所辖人员记录，处理当班监管事项。"
            : "查阅本人在押记录与呈报事项的办理进度。"
        }
      />
      <div className="surface-panel">
        <EmptyState
          icon={Inbox}
          title="暂无登记记录"
          description="此项暂无已登记记录，请留意后续监所通知。"
        />
      </div>
    </div>
  )
}
