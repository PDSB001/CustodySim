import { and, eq, gt } from "drizzle-orm"
import { z } from "zod"
import { db } from "@/lib/db"
import { rules } from "@/lib/db/schema"
import { getAdminUser } from "@/lib/admin-api"
import { failure, success } from "@/lib/api-response"
import { writeAuditLog } from "@/lib/audit"
import { ReadingRuleUpdate } from "@/lib/library-task-config"

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const actor = await getAdminUser()
  if (!actor) return failure("FORBIDDEN", "仅管理员可管理阅读任务", 403)
  const id = z
    .string()
    .uuid()
    .safeParse((await context.params).id)
  const parsed = ReadingRuleUpdate.safeParse(
    await request.json().catch(() => null),
  )
  if (!id.success || !parsed.success)
    return failure("VALIDATION_ERROR", "任务设置不合法", 400)
  const result = await db.transaction(async (tx) => {
    const condition = and(
      eq(rules.id, id.data),
      eq(rules.taskType, "STUDY"),
      gt(rules.readingMinutes, 0),
    )
    const [rule] = await tx.select().from(rules).where(condition).for("update")
    if (!rule) return { error: "阅读任务不存在", status: 404 }
    const { timeSlot, ...patch } = parsed.data
    if (
      (patch.readingMinutes ?? rule.readingMinutes) >
      (patch.timeoutMinutes ?? rule.timeoutMinutes)
    )
      return { error: "阅读要求不能超过任务有效时长", status: 400 }
    if (
      timeSlot &&
      (rule.freq !== "DAILY" ||
        !Array.isArray(rule.timeSlots) ||
        rule.timeSlots.length !== 1)
    )
      return {
        error: "多时段或非每日任务请在任务编排中调整下发时间",
        status: 400,
      }
    const [updated] = await tx
      .update(rules)
      .set({
        ...patch,
        ...(timeSlot ? { timeSlots: [timeSlot] } : {}),
        updatedAt: new Date(),
      })
      .where(condition)
      .returning()
    await writeAuditLog(
      {
        actor,
        action: "UPDATE",
        actionLabel: "修改阅读任务",
        entityType: "rule",
        entityId: id.data,
        detail: parsed.data,
      },
      tx,
    )
    return { rule: updated }
  })
  return result.error
    ? failure(
        result.status === 404 ? "NOT_FOUND" : "VALIDATION_ERROR",
        result.error,
        result.status,
      )
    : success(result.rule)
}
