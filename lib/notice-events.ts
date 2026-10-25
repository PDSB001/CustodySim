import { eq, sql } from "drizzle-orm"

import { db } from "@/lib/db"
import { notices, noticeReads } from "@/lib/db/schema"
import {
  buildGroupedNotice,
  NoticeGroupSchema,
  parseNoticeGroup,
} from "@/lib/notice-content"
import type { NoticeEntry, NoticeGroup } from "@/lib/notice-content"
import { enqueueNoticeNotifications } from "@/lib/push-server"

type NoticeTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0]

/** Must run in the business transaction: no lost entries, duplicate bulletins or stale read receipts. */
export async function publishGroupedNotice(
  tx: NoticeTransaction,
  kind: NoticeGroup["kind"],
  period: string,
  entry: NoticeEntry,
  now: Date,
  notify = true,
) {
  const aggregationKey = `${kind}:${period}`
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtext(${`notice:${aggregationKey}`}))`,
  )
  const [existing] = await tx
    .select()
    .from(notices)
    .where(eq(notices.aggregationKey, aggregationKey))
    .limit(1)
    .for("update")
  const prior = parseNoticeGroup(existing?.metadata)
  const metadata: NoticeGroup = NoticeGroupSchema.parse({
    ...prior,
    kind,
    period,
    entries: { ...prior?.entries, [entry.id]: entry },
  })
  const text = buildGroupedNotice(metadata)
  if (
    existing &&
    existing.content === text.content &&
    JSON.stringify(prior) === JSON.stringify(metadata)
  )
    return existing.id
  if (existing) {
    await tx
      .update(notices)
      .set({
        ...text,
        metadata,
        updatedAt: new Date(
          Math.max(now.getTime(), existing.updatedAt.getTime() + 1),
        ),
      })
      .where(eq(notices.id, existing.id))
    await tx.delete(noticeReads).where(eq(noticeReads.noticeId, existing.id))
    if (notify) await enqueueNoticeNotifications(tx, existing.id)
    return existing.id
  }
  const [created] = await tx
    .insert(notices)
    .values({
      ...text,
      aggregationKey,
      metadata,
      targetRole: "ALL",
      priority: "IMPORTANT",
      published: true,
      publishedAt: now,
      createdAt: now,
      updatedAt: now,
    })
    .returning({ id: notices.id })
  if (!created) throw new Error("创建合并通知失败")
  if (notify) await enqueueNoticeNotifications(tx, created.id)
  return created.id
}
