import { and, eq } from "drizzle-orm"
import { z } from "zod"
import { failure, success } from "@/lib/api-response"
import { db } from "@/lib/db"
import {
  libraryBooks,
  readingProgress,
  readingSessions,
  readingTicks,
  users,
} from "@/lib/db/schema"
import { creditedReadingSeconds } from "@/lib/library"
import { getSessionUser } from "@/lib/session"
import { ensureUserTasks } from "@/lib/task-engine"
import { settleReadingTasks, settleReadingPoints } from "@/lib/reading-server"

const Start = z.object({ bookId: z.string().uuid() })
const Tick = z.object({
  sessionId: z.string().uuid(),
  active: z.boolean(),
  close: z.boolean().default(false),
  page: z.number().int().min(1).max(100000),
})

export async function POST(request: Request) {
  const actor = await getSessionUser()
  if (!actor) return failure("UNAUTHORIZED", "请先登录", 401)
  const parsed = Start.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return failure("VALIDATION_ERROR", "参数不合法", 400)
  if (actor.role === "SUPERVISED") await ensureUserTasks(actor.id)
  const session = await db.transaction(async (tx) => {
    // Lock the user so simultaneous starts on different devices cannot both remain active.
    await tx
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, actor.id))
      .for("update")
    const [book] = await tx
      .select({
        enabled: libraryBooks.enabled,
        deletedAt: libraryBooks.deletedAt,
      })
      .from(libraryBooks)
      .where(eq(libraryBooks.id, parsed.data.bookId))
    if (!book?.enabled || book.deletedAt) return null
    await tx
      .update(readingSessions)
      .set({ closed: true, active: false })
      .where(
        and(
          eq(readingSessions.userId, actor.id),
          eq(readingSessions.closed, false),
        ),
      )
    const [created] = await tx
      .insert(readingSessions)
      .values({ userId: actor.id, bookId: parsed.data.bookId })
      .returning({ sessionId: readingSessions.id })
    return created
  })
  return session
    ? success(session)
    : failure("NOT_FOUND", "书籍不存在或已下架", 404)
}

export async function PATCH(request: Request) {
  const actor = await getSessionUser()
  if (!actor) return failure("UNAUTHORIZED", "请先登录", 401)
  const parsed = Tick.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return failure("VALIDATION_ERROR", "参数不合法", 400)
  const tick = parsed.data
  const result = await db.transaction(async (tx) => {
    await tx
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, actor.id))
      .for("update")
    const [session] = await tx
      .select()
      .from(readingSessions)
      .where(
        and(
          eq(readingSessions.id, tick.sessionId),
          eq(readingSessions.userId, actor.id),
        ),
      )
      .for("update")
    if (!session || session.closed) return null
    const [book] = await tx
      .select({
        enabled: libraryBooks.enabled,
        deletedAt: libraryBooks.deletedAt,
      })
      .from(libraryBooks)
      .where(eq(libraryBooks.id, session.bookId))
    if (!book?.enabled || book.deletedAt) return null
    const now = new Date()
    const seconds = creditedReadingSeconds(
      session.lastHeartbeat,
      now,
      session.active,
    )
    let awardedPoints = 0
    let approvedTasks = 0
    if (seconds) {
      const [entry] = await tx
        .insert(readingTicks)
        .values({
          sessionId: session.id,
          userId: actor.id,
          bookId: session.bookId,
          startedAt: session.lastHeartbeat,
          endedAt: now,
          seconds,
        })
        .returning({ id: readingTicks.id })
      if (actor.role === "SUPERVISED") {
        approvedTasks = await settleReadingTasks(tx, actor.id, now)
        awardedPoints = await settleReadingPoints(tx, actor.id, entry.id, now)
      }
    }
    await tx
      .update(readingSessions)
      .set({
        lastHeartbeat: now,
        active: tick.active && !tick.close,
        closed: tick.close,
      })
      .where(eq(readingSessions.id, session.id))
    await tx
      .insert(readingProgress)
      .values({
        userId: actor.id,
        bookId: session.bookId,
        page: tick.page,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [readingProgress.userId, readingProgress.bookId],
        set: { page: tick.page, updatedAt: now },
      })
    return { creditedSeconds: seconds, awardedPoints, approvedTasks }
  })
  return result
    ? success(result)
    : failure("CONFLICT", "阅读会话已结束，请重新打开书籍", 409)
}
