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

import { CheckinHomeCard } from "@/components/checkin/checkin-workspaces"
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
import type { SessionUser } from "@/lib/session"

type WorkspaceKind = "SUPERVISOR" | "SUPERVISED"

const UiConfigSchema = z.object({
  scope: z.string(),
  homeTitle: z.string(),
  homeSubtitle: z.string(),
  homeBanner: z.string(),
})

const DashboardSummarySchema = z.object({
  pendingTasks: z.number(),
  pendingMakeups: z.number(),
  pendingCheckins: z.number(),
  myPendingTasks: z.number(),
  inCustodyPersons: z.number(),
  enabledRules: z.number(),
  custodyStatus: z.string(),
  unreadNotices: z.number(),
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
        label: "待审核任务",
        value: "0",
        detail: <span>任务提交</span>,
        icon: ClipboardCheck,
        tone: "brand" as const,
      },
      {
        label: "补卡申请",
        value: "0",
        detail: <span>等待处理</span>,
        icon: TimerReset,
        tone: "warning" as const,
      },
      {
        label: "未读通知",
        value: "0",
        detail: <span>待查阅的正式通知</span>,
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
        label: "待完成任务",
        value: "0",
        detail: <span>尚未提交的任务</span>,
        icon: ClipboardCheck,
        tone: "brand" as const,
      },
      {
        label: "未读通知",
        value: "0",
        detail: <span>待查阅的监所通知</span>,
        icon: BellRing,
        tone: "info" as const,
      },
      {
        label: "在押状态",
        value: "正常",
        detail: <span>以在押档案为准</span>,
        icon: UserRound,
        tone: "success" as const,
      },
    ],
  },
} as const

const serviceLinks = {
  SUPERVISOR: [
    {
      href: "/supervisor/tasks",
      label: "任务批阅",
      detail: "处理已提交任务",
      icon: ClipboardCheck,
    },
    {
      href: "/supervisor/checkins",
      label: "点名总览",
      detail: "查看今日执行状态",
      icon: CalendarCheck2,
    },
    {
      href: "/supervisor/makeups",
      label: "补卡审核",
      detail: "处理逾期申请",
      icon: TimerReset,
    },
    {
      href: "/supervisor/reports",
      label: "执行汇报",
      detail: "查看与提交汇报",
      icon: FileText,
    },
  ],
  SUPERVISED: [
    {
      href: "/my/tasks",
      label: "服刑任务",
      detail: "完成指定内容，提交监管员批阅",
      icon: ClipboardCheck,
    },
    {
      href: "/my/checkins",
      label: "点名打卡",
      detail: "查看时段与补卡状态",
      icon: CalendarCheck2,
    },
    {
      href: "/my/notices",
      label: "通知公告",
      detail: "查阅监所通知与执行要求",
      icon: BellRing,
    },
    {
      href: "/my/profile",
      label: "个人档案",
      detail: "查看监管与身份信息",
      icon: UserRound,
    },
  ],
} as const

function ServiceLinks({ kind }: { kind: WorkspaceKind }) {
  return (
    <div className="surface-panel overflow-hidden">
      <div className="surface-panel__head">
        <h2 className="surface-panel__title">
          <span className="glyph">
            <ArrowRight className="size-3.5" />
          </span>
          {kind === "SUPERVISOR" ? "执勤入口" : "监室事务"}
        </h2>
        <p className="surface-panel__sub">
          {kind === "SUPERVISOR"
            ? "审核、点名与执行记录"
            : "呈报任务、查阅通知与在押档案"}
        </p>
      </div>
      <div className="divide-border/60 divide-y">
        {serviceLinks[kind].map(({ href, label, detail, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className="group hover:bg-muted/50 flex items-center gap-3 px-5 py-3 transition-colors sm:px-6"
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
  )
}

function WorkspacePriority({
  kind,
  summary,
}: {
  kind: WorkspaceKind
  summary: z.infer<typeof DashboardSummarySchema>
}) {
  const isOnLeave = summary.custodyStatus.includes("请假")
  const pendingReviewCount = summary.pendingTasks + summary.pendingMakeups
  const priority =
    kind === "SUPERVISOR"
      ? pendingReviewCount > 0
        ? {
            href: summary.pendingTasks
              ? "/supervisor/tasks"
              : "/supervisor/makeups",
            title: `有 ${pendingReviewCount} 项监管事项待处理`,
            description: "优先处理任务审核与补卡申请，避免待办积压。",
            action: "前往处理",
            icon: ClipboardCheck,
          }
        : {
            href: "/supervisor/checkins",
            title: "任务与补卡暂无待审",
            description: "核对今日点名记录，留意漏点与补卡情况。",
            action: "查看点名记录",
            icon: CalendarCheck2,
          }
      : isOnLeave
        ? {
            href: "/my/checkins",
            title: `当前为${summary.custodyStatus}`,
            description: "请假期间无需手动打卡或申请补卡，系统会按规则处理。",
            action: "查看打卡说明",
            icon: CalendarCheck2,
          }
        : summary.myPendingTasks > 0
          ? {
              href: "/my/tasks",
              title: `还有 ${summary.myPendingTasks} 项任务待呈报`,
              description: "按截止时间完成指定内容，提交后等待监管员批阅。",
              action: "查看服刑任务",
              icon: ClipboardCheck,
            }
          : {
              href: "/my/checkins",
              title: "当前没有待提交任务",
              description: "仍需按时完成点名打卡，并留意监所通知与批阅结果。",
              action: "查看打卡记录",
              icon: CalendarCheck2,
            }
  const Icon = priority.icon

  return (
    <Link
      href={priority.href}
      className="surface-panel surface-panel--brand priority-action group page-enter"
    >
      <span className="bg-brand-500/12 text-brand-700 grid size-10 shrink-0 place-items-center rounded-xl">
        <Icon className="size-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="text-foreground block text-sm font-semibold">
          {priority.title}
        </span>
        <span className="text-muted-foreground mt-1 block text-sm">
          {priority.description}
        </span>
      </span>
      <span className="priority-action__cta">
        {priority.action}
        <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
      </span>
    </Link>
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
    return <LoadingBlock className="surface-panel motion-item h-40" />
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
          部分信息来自个人档案。如与在押情况不符，请向管理处申请核对。
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
    return <LoadingBlock className="surface-panel motion-item h-40" />
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
  const dynamicValues: Record<string, string> =
    kind === "SUPERVISOR"
      ? {
          待审核任务: String(summary.data?.pendingTasks ?? 0),
          补卡申请: String(summary.data?.pendingMakeups ?? 0),
          未读通知: String(summary.data?.unreadNotices ?? 0),
        }
      : {
          待完成任务: String(summary.data?.myPendingTasks ?? 0),
          未读通知: String(summary.data?.unreadNotices ?? 0),
          在押状态: summary.data?.custodyStatus ?? "待核实",
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
        action={
          <StatusPill tone={content.tone}>{content.toneLabel}</StatusPill>
        }
      />

      {summary.isLoading ? (
        <LoadingBlock className="page-enter h-20" />
      ) : summary.data && !summary.error ? (
        <WorkspacePriority kind={kind} summary={summary.data} />
      ) : null}

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
          {content.cards.map(({ label, value, detail, icon, tone }) => (
            <MetricCell
              key={label}
              label={label}
              value={dynamicValues[label] ?? value}
              detail={detail}
              icon={icon}
              tone={tone}
            />
          ))}
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
              <p className="surface-panel__sub">当前监管范围内的待审事项</p>
            </div>
            <QueryStateView
              isLoading={summary.isLoading}
              error={summary.error}
              onRetry={() => summary.refetch()}
              loading={<LoadingBlock className="h-36" />}
            >
              <div className="divide-border/60 divide-y">
                {[
                  {
                    href: "/supervisor/tasks",
                    label: "任务批阅",
                    count: summary.data?.pendingTasks,
                    detail: "核对呈报内容，给出批阅意见",
                  },
                  {
                    href: "/supervisor/makeups",
                    label: "补卡审核",
                    count: summary.data?.pendingMakeups,
                    detail: "核实漏点原因与补卡凭据",
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
        <section className="page-enter grid items-start gap-4 lg:grid-cols-[minmax(0,1.25fr)_minmax(16rem,0.75fr)]">
          <div className="surface-panel">
            <div className="surface-panel__head">
              <h2 className="surface-panel__title">
                <span className="glyph">
                  <CalendarCheck2 className="size-3.5" />
                </span>
                今日点名 · 打卡
              </h2>
              <p className="surface-panel__sub">
                按规定时段报到，漏点需申请补卡
              </p>
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
