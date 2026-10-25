import { and, eq, gt, inArray, isNull, or, sql } from "drizzle-orm"

import { db } from "@/lib/db"
import { isolationOrders, noticeReads, notices, users } from "@/lib/db/schema"
import type { NoticeEntry, NoticeGroup } from "@/lib/notice-content"
import { parseNoticeGroup } from "@/lib/notice-content"
import { publishGroupedNotice } from "@/lib/notice-events"
import { getShanghaiDateKey } from "@/lib/shanghai-datetime"

type SourceNotice = typeof notices.$inferSelect

function previousWeek(date: Date) {
  const day = new Date(`${getShanghaiDateKey(date)}T00:00:00+08:00`)
  const weekday = new Date(getShanghaiDateKey(date)).getUTCDay()
  day.setUTCDate(day.getUTCDate() - ((weekday + 6) % 7) - 7)
  return getShanghaiDateKey(day)
}

export function legacyNoticeEvent(
  notice: Pick<
    SourceNotice,
    "id" | "title" | "content" | "createdBy" | "createdAt" | "publishedAt"
  >,
) {
  const time = notice.publishedAt ?? notice.createdAt
  const entry: NoticeEntry = {
    id: `legacy:${notice.id}`,
    name: "",
    body: notice.content,
    occurredAt: time.toISOString(),
  }
  const start =
    notice.createdBy === null && notice.title === "禁闭公示"
      ? /^(.+) 因周度考核记分为 (-?\d+) 分，依积分规则执行禁闭。执行期限：/.exec(
          notice.content,
        )
      : null
  if (start)
    return {
      kind: "ISOLATION" as const,
      period: previousWeek(time),
      entry: { ...entry, name: start[1]!, score: Number(start[2]) },
    }
  const correction =
    notice.createdBy === null && notice.title === "积分周结更正"
      ? /^(.+) 的 (\d{4}-\d{2}-\d{2}) 周积分经跨周流水校正后不再满足禁闭条件，原禁闭决定已撤销。$/.exec(
          notice.content,
        )
      : null
  if (correction)
    return {
      kind: "ISOLATION_CORRECTION" as const,
      period: correction[2]!,
      entry: { ...entry, name: correction[1]!, status: "CANCELLED" as const },
    }
  const name = notice.title.startsWith("禁闭检讨汇报 · ")
    ? notice.title.slice("禁闭检讨汇报 · ".length).trim()
    : ""
  if (name)
    return {
      kind: "ISOLATION_REFLECTION" as const,
      period: getShanghaiDateKey(time),
      entry: { ...entry, name },
    }
  return null
}

/** Non-destructive archive: original rows/read receipts remain; only their publication is switched off. */
export async function mergeLegacyNoticeHistory({
  apply = false,
  noticeIds,
}: { apply?: boolean; noticeIds?: string[] } = {}) {
  if (noticeIds?.length === 0)
    return { sourceNotices: 0, groups: 0, applied: apply }
  const sources = await db
    .select()
    .from(notices)
    .where(
      and(
        eq(notices.published, true),
        eq(notices.targetRole, "ALL"),
        or(isNull(notices.expiresAt), gt(notices.expiresAt, new Date())),
        isNull(notices.aggregationKey),
        isNull(notices.metadata),
        noticeIds ? inArray(notices.id, noticeIds) : undefined,
      ),
    )
  const groups = new Map<
    string,
    {
      kind: NoticeGroup["kind"]
      period: string
      sources: SourceNotice[]
      entries: NoticeEntry[]
    }
  >()
  for (const source of sources) {
    const event = legacyNoticeEvent(source)
    if (!event) continue
    const key = `${event.kind}:${event.period}`
    const group = groups.get(key) ?? {
      kind: event.kind,
      period: event.period,
      sources: [],
      entries: [],
    }
    group.sources.push(source)
    group.entries.push(event.entry)
    groups.set(key, group)
  }
  const summary = {
    sourceNotices: [...groups.values()].reduce(
      (total, group) => total + group.sources.length,
      0,
    ),
    groups: groups.size,
    applied: apply,
  }
  if (!apply || !groups.size) return summary
  const orders = await db
    .select({ order: isolationOrders, name: users.name })
    .from(isolationOrders)
    .innerJoin(users, eq(users.id, isolationOrders.supervisedId))
  // Stable lock order also makes two migration attempts safe to run concurrently.
  for (const [key, group] of [...groups.entries()].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    await db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${`notice:${key}`}))`,
      )
      const live = await tx
        .select()
        .from(notices)
        .where(
          and(
            inArray(
              notices.id,
              group.sources.map((n) => n.id),
            ),
            eq(notices.published, true),
            isNull(notices.metadata),
          ),
        )
        .orderBy(notices.id)
        .for("update")
      if (!live.length) return
      const [existing] = await tx
        .select()
        .from(notices)
        .where(eq(notices.aggregationKey, key))
        .limit(1)
        .for("update")
      const required = [
        ...live.map((n) => n.id),
        ...(existing ? [existing.id] : []),
      ]
      const fullyRead = await tx
        .select({ userId: noticeReads.userId })
        .from(noticeReads)
        .where(inArray(noticeReads.noticeId, required))
        .groupBy(noticeReads.userId)
        .having(
          sql`count(distinct ${noticeReads.noticeId}) = ${required.length}`,
        )
      let parentId = existing?.id
      const timestamp = new Date(
        Math.max(
          existing?.updatedAt.getTime() ?? 0,
          ...live.map((source) =>
            (source.publishedAt ?? source.createdAt).getTime(),
          ),
        ),
      )
      for (const source of live) {
        const event = legacyNoticeEvent(source)!
        let entry = event.entry
        if (event.kind === "ISOLATION") {
          const matches = orders.filter(
            ({ order, name }) =>
              name === entry.name &&
              order.weekKey === event.period &&
              order.triggerScore === entry.score &&
              source.content.includes(
                order.startAt.toLocaleString("zh-CN", {
                  timeZone: "Asia/Shanghai",
                }),
              ) &&
              source.content.includes(
                order.endAt.toLocaleString("zh-CN", {
                  timeZone: "Asia/Shanghai",
                }),
              ),
          )
          if (matches.length === 1) {
            const order = matches[0]!.order
            entry = {
              ...entry,
              id: order.id,
              startAt: order.startAt.toISOString(),
              endAt: order.endAt.toISOString(),
              status:
                order.status === "CANCELLED"
                  ? "CANCELLED"
                  : order.status === "COMPLETED"
                    ? "COMPLETED"
                    : "ACTIVE",
            }
            const current = parseNoticeGroup(existing?.metadata)?.entries[
              order.id
            ]
            if (current) entry = current
          }
        }
        parentId = await publishGroupedNotice(
          tx,
          event.kind,
          event.period,
          entry,
          timestamp,
          false,
        )
      }
      if (!parentId) return
      const [parent] = await tx
        .select()
        .from(notices)
        .where(eq(notices.id, parentId))
        .limit(1)
      const metadata = parseNoticeGroup(parent!.metadata)!
      const archivedNoticeIds = [
        ...new Set([
          ...(metadata.archivedNoticeIds ?? []),
          ...live.map((n) => n.id),
        ]),
      ]
      await tx
        .update(notices)
        .set({ metadata: { ...metadata, archivedNoticeIds } })
        .where(eq(notices.id, parentId))
      await tx
        .update(notices)
        .set({
          published: false,
          updatedAt: new Date(),
          metadata: {
            archivedInto: parentId,
            archivedAt: new Date().toISOString(),
          },
        })
        .where(
          inArray(
            notices.id,
            live.map((n) => n.id),
          ),
        )
      if (fullyRead.length)
        await tx
          .insert(noticeReads)
          .values(
            fullyRead.map(({ userId }) => ({ userId, noticeId: parentId! })),
          )
          .onConflictDoNothing()
    })
  }
  return summary
}
