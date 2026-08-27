import { eq } from "drizzle-orm"
import { NextRequest } from "next/server"
import { z } from "zod"
import { failure, success } from "@/lib/api-response"
import { db } from "@/lib/db"
import { reportSubmissions, reportTasks } from "@/lib/db/schema"
import { validateFieldPayload } from "@/lib/fields"
import { getSessionUser } from "@/lib/session"

const SubmissionSchema = z.object({
  taskId: z.string().uuid(),
  data: z.record(z.string(), z.unknown()),
})
const TemplateSnapshotSchema = z.object({
  fields: z
    .array(
      z.object({
        name: z.string(),
        type: z.enum(["TEXT", "TEXTAREA", "NUMBER", "SELECT", "DATE", "COPYWRITE", "IMAGE"]),
        required: z.boolean(),
        options: z.array(z.string()),
      }),
    )
    .default([]),
})
export async function POST(request: NextRequest) {
  const actor = await getSessionUser()
  if (!actor) return failure("UNAUTHORIZED", "请先登录", 401)
  if (actor.role !== "SUPERVISED")
    return failure("FORBIDDEN", "仅被监管人可提交汇报", 403)
  const parsed = SubmissionSchema.safeParse(await request.json())
  if (!parsed.success) return failure("VALIDATION_ERROR", "提交数据不合法", 400)
  const [task] = await db
    .select()
    .from(reportTasks)
    .where(eq(reportTasks.id, parsed.data.taskId))
    .limit(1)
  if (!task || task.supervisedId !== actor.id)
    return failure("FORBIDDEN", "无权提交该任务", 403)
  if (task.deadline < new Date())
    return failure("VALIDATION_ERROR", "任务已超过截止时间", 400)
  if (task.status !== "PENDING" && task.status !== "RETURNED")
    return failure(
      "VALIDATION_ERROR",
      task.status === "SUBMITTED" ? "任务已提交，请勿重复提交" : "该任务当前不可提交",
      400,
    )
  const template = TemplateSnapshotSchema.parse(task.templateSnapshot)
  const check = validateFieldPayload(template.fields, parsed.data.data)
  if (!check.valid)
    return failure("VALIDATION_ERROR", JSON.stringify(check.errors), 400)
  const [submission] = await db
    .insert(reportSubmissions)
    .values({
      taskId: task.id,
      userId: actor.id,
      content: JSON.stringify(parsed.data.data),
      data: parsed.data.data,
    })
    .returning()
  await db
    .update(reportTasks)
    .set({ status: "SUBMITTED", updatedAt: new Date() })
    .where(eq(reportTasks.id, task.id))
  return submission
    ? success(submission, { status: 201 })
    : failure("INTERNAL_ERROR", "提交失败", 500)
}
