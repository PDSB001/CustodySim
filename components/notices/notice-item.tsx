import type { ReactNode } from "react"

import { formatDate } from "@/components/shared/api-client"
import { StatusPill } from "@/components/shared/status-pill"
import {
  formatNoticeTime,
  noticeGroupEntries,
  parseNoticeGroup,
} from "@/lib/notice-content"

export type NoticeDisplay = {
  id: string
  title: string
  content: string
  targetRole: string
  priority: string
  createdAt: string
  publishedAt: string | null
  expiresAt: string | null
  updatedAt?: string
  metadata?: unknown
  readAt?: string | null
  published?: boolean
}

export function NoticeItem({
  notice,
  actions,
  admin = false,
}: {
  notice: NoticeDisplay
  actions?: ReactNode
  admin?: boolean
}) {
  const group = parseNoticeGroup(notice.metadata)
  const entries = group ? noticeGroupEntries(group) : []
  const commonPeriod =
    entries[0]?.startAt &&
    entries[0]?.endAt &&
    entries.every(
      (e) => e.startAt === entries[0]!.startAt && e.endAt === entries[0]!.endAt,
    )
  const cancelled = entries.filter((e) => e.status === "CANCELLED").length
  const archived = Boolean(
    notice.metadata &&
    typeof notice.metadata === "object" &&
    "archivedInto" in notice.metadata,
  )
  const unread = !admin && !notice.readAt
  const audience: Record<string, string> = {
    ALL: "全体人员",
    SUPERVISED: "在押人员",
    SUPERVISOR: "监管员",
    ADMIN: "管理处",
  }
  const priorities: Record<string, string> = {
    NORMAL: "普通",
    IMPORTANT: "重要",
    URGENT: "紧急",
  }
  const preview = group
    ? `${group.period} · ${entries.length}${group.kind === "ISOLATION_REFLECTION" ? "份检讨" : "人"}：${entries
        .slice(0, 6)
        .map(
          (e) => `${e.name}${e.score === undefined ? "" : `（${e.score}分）`}`,
        )
        .join("、")}${entries.length > 6 ? "等" : ""}`
    : notice.content

  return (
    <article
      className={`bg-card rounded-xl border px-4 py-3 ${unread ? "border-l-brand-500 border-l-3" : "border-border"}`}
      data-testid="notice-item"
    >
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="min-w-0 text-sm font-semibold break-words">
              {notice.title}
            </h2>
            <StatusPill
              tone={
                notice.priority === "URGENT"
                  ? "danger"
                  : notice.priority === "IMPORTANT"
                    ? "warning"
                    : "neutral"
              }
            >
              {priorities[notice.priority] ?? notice.priority}
            </StatusPill>
            {unread ? (
              <span className="text-brand-600 text-xs font-medium">未读</span>
            ) : null}
            {admin ? (
              <span className="text-muted-foreground text-xs">
                {archived
                  ? "已归档"
                  : notice.published === false
                    ? "已下架"
                    : "已发布"}
              </span>
            ) : null}
          </div>
          <p className="text-muted-foreground flex flex-wrap gap-x-3 gap-y-0.5 text-xs">
            <span>{audience[notice.targetRole] ?? "指定人员"}</span>
            <time dateTime={notice.publishedAt ?? notice.createdAt}>
              {formatDate(notice.publishedAt ?? notice.createdAt)}
            </time>
            {notice.updatedAt &&
            new Date(notice.updatedAt).getTime() >
              new Date(notice.publishedAt ?? notice.createdAt).getTime() +
                1000 ? (
              <span>更新于 {formatDate(notice.updatedAt)}</span>
            ) : null}
            {notice.expiresAt ? (
              <span>有效至 {formatDate(notice.expiresAt)}</span>
            ) : null}
            {group ? <span>合并公示 · {entries.length} 条明细</span> : null}
          </p>
        </div>
        {actions ? (
          <div className="flex shrink-0 items-center gap-1.5">{actions}</div>
        ) : null}
      </div>
      <p className="text-muted-foreground mt-2 line-clamp-2 text-sm leading-5 break-words whitespace-pre-line">
        {preview}
      </p>
      {group?.kind === "ISOLATION" &&
      entries[0]?.startAt &&
      entries[0]?.endAt ? (
        <p className="text-muted-foreground mt-1 text-xs">
          {commonPeriod
            ? `执行：${formatNoticeTime(entries[0].startAt)} — ${formatNoticeTime(entries[0].endAt)}`
            : "执行时间各不相同，请展开人员明细"}
          {cancelled ? ` · ${cancelled} 人已撤销` : ""}
        </p>
      ) : null}
      <details className="mt-2 text-sm">
        <summary className="text-brand-600 w-fit cursor-pointer text-xs">
          {group ? `展开 ${entries.length} 条明细` : "查看全文"}
        </summary>
        {group ? (
          <div className="divide-border mt-2 divide-y">
            {entries.map((entry) => (
              <section key={entry.id} className="space-y-1 py-2 first:pt-0">
                <div className="flex flex-wrap items-center justify-between gap-1 text-sm">
                  <span className="font-medium">
                    {entry.name}
                    {entry.score === undefined ? "" : ` · ${entry.score} 分`}
                  </span>
                  <span className="text-muted-foreground text-xs">
                    {entry.status === "CANCELLED"
                      ? "已撤销禁闭"
                      : entry.status === "COMPLETED"
                        ? "已执行完毕"
                        : group.kind === "ISOLATION_REFLECTION"
                          ? "审核通过"
                          : "禁闭决定"}{" "}
                    · {formatNoticeTime(entry.occurredAt)}
                  </span>
                </div>
                {entry.startAt && entry.endAt ? (
                  <p className="text-muted-foreground text-xs">
                    执行：{formatNoticeTime(entry.startAt)} —{" "}
                    {formatNoticeTime(entry.endAt)}
                  </p>
                ) : null}
                {entry.body &&
                (group.kind !== "ISOLATION" || !entry.startAt) ? (
                  <p className="text-foreground text-sm leading-6 break-words whitespace-pre-wrap">
                    {entry.body}
                  </p>
                ) : null}
              </section>
            ))}
            {group.kind === "ISOLATION" ? (
              <p className="text-muted-foreground pt-2 text-xs leading-5">
                执行要求：按加强点名安排报到，按时呈报每日反思任务；已撤销的决定不再执行。
              </p>
            ) : null}
            {group.archivedNoticeIds?.length ? (
              <p className="text-muted-foreground pt-2 text-xs">
                已整理 {group.archivedNoticeIds.length}{" "}
                条历史通知，原记录归档保留。
              </p>
            ) : null}
          </div>
        ) : (
          <p className="mt-2 text-sm leading-6 break-words whitespace-pre-wrap">
            {notice.content}
          </p>
        )}
      </details>
    </article>
  )
}
