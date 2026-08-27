import { desc, eq, inArray } from "drizzle-orm"

import { failure, success } from "@/lib/api-response"
import { db } from "@/lib/db"
import { reportSubmissions, reportTasks, users } from "@/lib/db/schema"
import { getSessionUser } from "@/lib/session"
import { getSupervisedUserIdsForActor } from "@/lib/supervision-scope"
import { ensureUserTasks } from "@/lib/task-engine"

export async function GET() {
  const actor = await getSessionUser()
  if (!actor) return failure("UNAUTHORIZED", "请先登录", 401)
  try {
    if (actor.role === "SUPERVISED") await ensureUserTasks(actor.id)
    const ids = [...(await getSupervisedUserIdsForActor(actor))]
    if (!ids.length) return success([])
    const rows = await db
      .select({
        id: reportTasks.id,
        title: reportTasks.title,
        supervisedId: reportTasks.supervisedId,
        supervisedName: users.name,
        scheduleAt: reportTasks.scheduleAt,
        deadline: reportTasks.deadline,
        status: reportTasks.status,
        templateSnapshot: reportTasks.templateSnapshot,
        submissionId: reportSubmissions.id,
        content: reportSubmissions.content,
        data: reportSubmissions.data,
        submissionStatus: reportSubmissions.status,
        officialSealData: reportSubmissions.officialSealData,
      })
      .from(reportTasks)
      .leftJoin(reportSubmissions, eq(reportSubmissions.taskId, reportTasks.id))
      .leftJoin(users, eq(users.id, reportTasks.supervisedId))
      .where(inArray(reportTasks.supervisedId, ids))
      .orderBy(desc(reportTasks.scheduleAt))
    return success(rows)
  } catch (error) {
    console.error("[API tasks GET]", error)
    return failure("INTERNAL_ERROR", "服务器错误", 500)
  }
}
