import { z } from "zod"

export const NoticeEntrySchema = z.object({
  id: z.string(),
  name: z.string(),
  score: z.number().optional(),
  startAt: z.string().optional(),
  endAt: z.string().optional(),
  status: z.enum(["ACTIVE", "CANCELLED", "COMPLETED"]).optional(),
  body: z.string().optional(),
  occurredAt: z.string(),
})

export const NoticeGroupSchema = z.object({
  kind: z.enum(["ISOLATION", "ISOLATION_CORRECTION", "ISOLATION_REFLECTION"]),
  period: z.string(),
  entries: z.record(z.string(), NoticeEntrySchema),
  archivedNoticeIds: z.array(z.string()).optional(),
})

export type NoticeGroup = z.infer<typeof NoticeGroupSchema>
export type NoticeEntry = z.infer<typeof NoticeEntrySchema>

export function parseNoticeGroup(value: unknown): NoticeGroup | null {
  const parsed = NoticeGroupSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}

export function noticeGroupEntries(group: NoticeGroup) {
  return Object.values(group.entries).sort(
    (a, b) =>
      a.occurredAt.localeCompare(b.occurredAt) || a.id.localeCompare(b.id),
  )
}

const dateTime = new Intl.DateTimeFormat("zh-CN", {
  timeZone: "Asia/Shanghai",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
})

export function formatNoticeTime(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : dateTime.format(date)
}

export function buildGroupedNotice(group: NoticeGroup) {
  const entries = noticeGroupEntries(group)
  const titles = {
    ISOLATION: "禁闭公示",
    ISOLATION_CORRECTION: "积分周结更正",
    ISOLATION_REFLECTION: "禁闭检讨汇报",
  }
  const header = `${group.period}${group.kind === "ISOLATION_REFLECTION" ? "" : " 周度考核"} · 共 ${entries.length} ${group.kind === "ISOLATION_REFLECTION" ? "份检讨" : "人"}`
  const lines = entries.map((entry, index) => {
    if (group.kind === "ISOLATION_REFLECTION")
      return `${index + 1}. ${entry.name} · 审核通过 ${formatNoticeTime(entry.occurredAt)}\n${entry.body ?? ""}`
    if (group.kind === "ISOLATION_CORRECTION")
      return `${index + 1}. ${entry.name} · ${entry.score === undefined ? "积分已校正" : `校正后 ${entry.score} 分`} · 已撤销禁闭\n${entry.body ?? "积分经校正后不再满足禁闭条件。"}`
    if (!entry.startAt && entry.body)
      return `${index + 1}. ${entry.name}\n${entry.body}`
    return `${index + 1}. ${entry.name} · ${entry.score ?? 0} 分 · ${entry.status === "CANCELLED" ? "已撤销" : entry.status === "COMPLETED" ? "已执行完毕" : "执行禁闭"}\n执行期限：${entry.startAt ? formatNoticeTime(entry.startAt) : "—"} 至 ${entry.endAt ? formatNoticeTime(entry.endAt) : "—"}`
  })
  const requirements =
    group.kind === "ISOLATION"
      ? "\n\n执行要求：禁闭期间按加强点名安排报到，按时呈报每日反思任务；已撤销的决定不再执行。"
      : ""
  return {
    title: titles[group.kind],
    content: `${header}\n\n${lines.join("\n\n")}${requirements}`,
  }
}
