import { and, desc, eq, sql, gte, lt, lte, inArray, isNull } from "drizzle-orm"
import { failure, success } from "@/lib/api-response"
import { db } from "@/lib/db"
import {
  libraryBooks,
  readingProgress,
  readingTicks,
  libraryScoreSettings,
  scoreEvents,
  reportTasks,
} from "@/lib/db/schema"
import { getSessionUser } from "@/lib/session"
import { getShanghaiDateKey } from "@/lib/shanghai-datetime"
import { ensureUserTasks } from "@/lib/task-engine"

export async function GET() {
  const actor = await getSessionUser()
  if (!actor) return failure("UNAUTHORIZED", "请先登录", 401)
  if (actor.role === "SUPERVISED") await ensureUserTasks(actor.id)
  const now = new Date()
  const dayStart = new Date(`${getShanghaiDateKey(now)}T00:00:00+08:00`)
  const dayEnd = new Date(dayStart.getTime() + 86400000)
  const books = await db
    .select({
      id: libraryBooks.id,
      title: libraryBooks.title,
      author: libraryBooks.author,
      format: libraryBooks.format,
      enabled: libraryBooks.enabled,
      coverAvailable: sql<boolean>`${libraryBooks.coverBytes} is not null`,
      coverUpdatedAt: libraryBooks.coverUpdatedAt,
      page: sql<number>`coalesce(${readingProgress.page}, 1)`,
      updatedAt: readingProgress.updatedAt,
      seconds: sql<number>`(select coalesce(sum(seconds), 0)::int from reading_ticks where user_id = ${actor.id}::uuid and book_id = ${libraryBooks.id})`,
    })
    .from(libraryBooks)
    .leftJoin(
      readingProgress,
      and(
        eq(readingProgress.bookId, libraryBooks.id),
        eq(readingProgress.userId, actor.id),
      ),
    )
    .where(
      and(
        isNull(libraryBooks.deletedAt),
        actor.role === "ADMIN" ? undefined : eq(libraryBooks.enabled, true),
      ),
    )
    .orderBy(desc(libraryBooks.createdAt))
  const [total] = await db
    .select({
      seconds: sql<number>`coalesce(sum(${readingTicks.seconds}), 0)::int`,
    })
    .from(readingTicks)
    .where(eq(readingTicks.userId, actor.id))
  const [policy] = await db
    .select()
    .from(libraryScoreSettings)
    .where(eq(libraryScoreSettings.id, 1))
  const [[todayDuration], [todayScore], readingTasks] = await Promise.all([
    db
      .select({
        seconds: sql<number>`coalesce(sum(${readingTicks.seconds}), 0)::int`,
      })
      .from(readingTicks)
      .where(
        and(
          eq(readingTicks.userId, actor.id),
          gte(readingTicks.endedAt, dayStart),
          lt(readingTicks.endedAt, dayEnd),
        ),
      ),
    db
      .select({
        points: sql<number>`coalesce(sum(${scoreEvents.points}), 0)::int`,
      })
      .from(scoreEvents)
      .where(
        and(
          eq(scoreEvents.supervisedId, actor.id),
          eq(scoreEvents.source, "READING_DURATION"),
          gte(scoreEvents.createdAt, dayStart),
          lt(scoreEvents.createdAt, dayEnd),
        ),
      ),
    actor.role === "SUPERVISED"
      ? db
          .select({
            id: reportTasks.id,
            title: reportTasks.title,
            status: reportTasks.status,
            readingMinutes: sql<number>`coalesce((${reportTasks.templateSnapshot}->>'readingMinutes')::integer, 0)`,
            readingSeconds: sql<number>`(select coalesce(sum(seconds), 0)::int from reading_ticks where user_id = ${reportTasks.supervisedId} and started_at >= ${reportTasks.scheduleAt} and ended_at <= least(now(), ${reportTasks.deadline}))`,
          })
          .from(reportTasks)
          .where(
            and(
              eq(reportTasks.supervisedId, actor.id),
              sql`${reportTasks.templateSnapshot}->>'completionMode' = 'READING'`,
              inArray(reportTasks.status, ["PENDING", "RETURNED", "APPROVED"]),
              lte(reportTasks.scheduleAt, now),
              gte(reportTasks.deadline, dayStart),
            ),
          )
          .orderBy(desc(reportTasks.scheduleAt))
          .limit(20)
      : Promise.resolve([]),
  ])
  return success({
    actorRole: actor.role,
    books: books.map(({ coverAvailable, coverUpdatedAt, ...book }) => ({
      ...book,
      coverUrl:
        coverAvailable ||
        (!coverUpdatedAt && ["EPUB", "DOCX"].includes(book.format))
          ? `/api/library/${book.id}/cover?v=${coverUpdatedAt?.getTime() ?? 0}`
          : null,
    })),
    totalSeconds: total?.seconds ?? 0,
    todaySeconds: todayDuration?.seconds ?? 0,
    todayPoints: todayScore?.points ?? 0,
    readingTasks,
    scorePolicy: policy ?? { enabled: true, minutesPerPoint: 15, dailyCap: 3 },
  })
}
