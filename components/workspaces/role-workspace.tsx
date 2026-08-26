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
  inCustodyPersons: z.number(),
  enabledRules: z.number(),
  custodyStatus: z.string(),
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
    eyebrow: "监管执行",
    tone: "info" as const,
    toneLabel: "监管范围正常",
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
        label: "风险提示",
        value: "0",
        detail: <span>当前正常</span>,
        icon: BellRing,
        tone: "danger" as const,
      },
    ],
  },
  SUPERVISED: {
    eyebrow: "今日服务",
    tone: "success" as const,
    toneLabel: "服务状态正常",
    cards: [
      {
        label: "待完成任务",
        value: "0",
        detail: <span>今日任务</span>,
        icon: ClipboardCheck,
        tone: "brand" as const,
      },
      {
        label: "未读通知",
        value: "0",
        detail: <span>暂无新消息</span>,
        icon: BellRing,
        tone: "info" as const,
      },
      {
        label: "档案状态",
        value: "正常",
        detail: <span>信息有效</span>,
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
      label: "任务审核",
      detail: "处理已提交任务",
      icon: ClipboardCheck,
    },
    {
      href: "/supervisor/checkins",
      label: "打卡总览",
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
      label: "我的任务",
      detail: "填写并提交任务表单",
      icon: ClipboardCheck,
    },
    {
      href: "/my/checkins",
      label: "打卡记录",
      detail: "查看时段与补卡状态",
      icon: CalendarCheck2,
    },
    {
      href: "/my/notices",
      label: "通知公告",
      detail: "查看监管通知",
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
          快捷入口
        </h2>
        <p className="surface-panel__sub">进入高频业务功能</p>
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
              <span className="text-muted-foreground mt-0.5 block text-[11px]">
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
      label: "所在组织",
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
          我的监管信息
        </h2>
        <p className="surface-panel__sub">编号、监室与档案摘要</p>
      </div>
      <div className="divide-border/60 grid divide-y sm:grid-cols-2 sm:divide-x sm:divide-y-0 lg:grid-cols-8">
        {fields.map(({ label, value, icon: Icon }) => (
          <div
            key={label}
            className={`min-w-0 px-5 py-4 sm:px-6 lg:px-5 ${label === "人员编号" || label === "所在组织" || label === "刑期起止" ? "lg:col-span-2" : ""}`}
          >
            <div className="text-muted-foreground flex items-center gap-1.5 text-xs font-medium">
              <Icon className="size-3.5" />
              {label}
            </div>
            <p
              className="text-foreground mt-2 break-words text-sm leading-5 font-semibold"
              title={value}
            >
              {value}
            </p>
          </div>
        ))}
      </div>
      {archiveLinked ? (
        <p className="border-border/60 text-muted-foreground border-t px-5 py-2.5 text-xs sm:px-6">
          部分信息已从个人档案同步；管理处维护主档后会优先显示主档数据。
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
  })
  const dynamicValues: Record<string, string> =
    kind === "SUPERVISOR"
      ? {
          待审核任务: String(summary.data?.pendingTasks ?? 0),
          补卡申请: String(summary.data?.pendingMakeups ?? 0),
        }
      : {
          待完成任务: String(summary.data?.pendingCheckins ?? 0),
          档案状态: summary.data?.custodyStatus ?? "正常",
        }
  const homeTitle = (uiConfig.data?.homeTitle ?? "你好，{name}").replace(
    "{name}",
    user.name,
  )
  const homeSubtitle =
    uiConfig.data?.homeSubtitle ??
    (kind === "SUPERVISOR"
      ? "集中处理今日任务、打卡异常、补卡审核与执行汇报。"
      : "查看今天需要完成的任务、打卡时段与通知，所有操作从这里开始。")

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

      <section className="metric-grid page-enter" aria-label="今日概览">
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
      </section>

      {kind === "SUPERVISED" ? <ProfileSummaryCard /> : null}
      {kind === "SUPERVISED" ? <RoommateSummaryCard /> : null}

      {kind === "SUPERVISOR" ? (
        <section className="page-enter grid gap-4 lg:grid-cols-[minmax(0,1.25fr)_minmax(16rem,0.75fr)]">
          <div className="surface-panel">
            <div className="surface-panel__head">
              <h2 className="surface-panel__title">
                <span className="glyph">
                  <Inbox className="size-3.5" />
                </span>
                待处理队列
              </h2>
              <p className="surface-panel__sub">按时效集中处理监管事项</p>
            </div>
            <EmptyState
              icon={Inbox}
              title="当前没有待处理事项"
              description="新的任务提交、补卡申请和风险提示会统一出现在这里。"
            />
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
                今日打卡
              </h2>
              <p className="surface-panel__sub">按时打卡，保持记录完整</p>
            </div>
            <div className="surface-panel__body">
              <CheckinHomeCard />
            </div>
          </div>
          <ServiceLinks kind={kind} />
        </section>
      )}
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
        eyebrow={kind === "SUPERVISOR" ? "监管执行" : "个人服务"}
        title={title}
        description={
          kind === "SUPERVISOR"
            ? "集中查看和处理本人监管范围内的业务事项。"
            : "查看与你相关的业务信息与办理状态。"
        }
      />
      <div className="surface-panel">
        <EmptyState
          icon={Inbox}
          title="暂无相关内容"
          description="数据接入后会在这里按时间和状态清晰展示。"
        />
      </div>
    </div>
  )
}
