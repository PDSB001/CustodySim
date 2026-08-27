import { eq } from "drizzle-orm"
import { NextRequest } from "next/server"
import { z } from "zod"

import { failure, success } from "@/lib/api-response"
import { db } from "@/lib/db"
import { reportSubmissions, reportTasks } from "@/lib/db/schema"
import { getSessionUser } from "@/lib/session"

const DraftSchema = z.object({
  taskId: z.string().uuid(),
  data: z.record(z.string(), z.unknown()),
})

export async function POST(request: NextRequest) {
  const actor = await getSessionUser()
  if (!actor) return failure("UNAUTHORIZED", "请先登录", 401)
  if (actor.role !== "SUPERVISED")
    return failure("FORBIDDEN", "仅被监管人可保存汇报草稿", 403)
  const parsed = DraftSchema.safeParse(await request.json())
  if (!parsed.success) return failure("VALIDATION_ERROR", "草稿数据不合法", 400)

  const [task] = await db
    .select({
      id: reportTasks.id,
      supervisedId: reportTasks.supervisedId,
      deadline: reportTasks.deadline,
      status: reportTasks.status,
    })
    .from(reportTasks)
    .where(eq(reportTasks.id, parsed.data.taskId))
    .limit(1)
  if (!task || task.supervisedId !== actor.id)
    return failure("FORBIDDEN", "无权保存该任务草稿", 403)
  if (task.deadline < new Date())
    return failure("VALIDATION_ERROR", "任务已超过截止时间", 400)
  if (task.status !== "PENDING" && task.status !== "RETURNED")
    return failure("VALIDATION_ERROR", "该任务当前不可保存草稿", 400)

  const now = new Date()
  const [draft] = await db
    .insert(reportSubmissions)
    .values({
      taskId: task.id,
      userId: actor.id,
      content: JSON.stringify(parsed.data.data),
      data: parsed.data.data,
      status: "DRAFT",
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: reportSubmissions.taskId,
      set: {
        content: JSON.stringify(parsed.data.data),
        data: parsed.data.data,
        status: "DRAFT",
        updatedAt: now,
      },
    })
    .returning({
      id: reportSubmissions.id,
      updatedAt: reportSubmissions.updatedAt,
    })
  return draft ? success(draft) : failure("INTERNAL_ERROR", "保存草稿失败", 500)
}
