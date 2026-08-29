import { eq, inArray } from "drizzle-orm"
import { NextRequest } from "next/server"
import { z } from "zod"

import { getAdminUser } from "@/lib/admin-api"
import { TaskPoolSchema } from "@/lib/admin-schemas"
import { failure, success } from "@/lib/api-response"
import { writeAuditLog } from "@/lib/audit"
import { db } from "@/lib/db"
import {
  reportTemplates,
  rules,
  taskPools,
  taskPoolTemplates,
} from "@/lib/db/schema"

const ParamsSchema = z.object({ id: z.string().uuid() })
type RouteContext = { params: Promise<{ id: string }> }

async function validateTemplates(templateIds: string[], kind: string) {
  const uniqueIds = [...new Set(templateIds)]
  const templates = await db
    .select()
    .from(reportTemplates)
    .where(inArray(reportTemplates.id, uniqueIds))
  if (templates.length !== uniqueIds.length) return null
  if (templates.some((template) => template.kind !== kind)) return null
  return { templates, uniqueIds }
}

export async function PUT(request: NextRequest, context: RouteContext) {
  const actor = await getAdminUser()
  if (!actor) return failure("FORBIDDEN", "仅管理员可管理随机任务池", 403)
  const params = ParamsSchema.safeParse(await context.params)
  const parsed = TaskPoolSchema.safeParse(await request.json())
  if (!params.success || !parsed.success)
    return failure("VALIDATION_ERROR", "随机任务池配置不合法", 400)
  try {
    const valid = await validateTemplates(
      parsed.data.templateIds,
      parsed.data.kind,
    )
    if (!valid)
      return failure(
        "VALIDATION_ERROR",
        "模板不存在，或与任务池类型不一致",
        400,
      )
    const linkedRules = await db
      .select({ taskType: rules.taskType })
      .from(rules)
      .where(eq(rules.taskPoolId, params.data.id))
    if (linkedRules.some((rule) => rule.taskType !== parsed.data.kind))
      return failure(
        "VALIDATION_ERROR",
        "任务池已关联规则，不能修改任务类型；请新建任务池后调整规则。",
        400,
      )
    const updated = await db.transaction(async (tx) => {
      const [pool] = await tx
        .update(taskPools)
        .set({
          name: parsed.data.name,
          kind: parsed.data.kind,
          enabled: parsed.data.enabled,
          updatedAt: new Date(),
        })
        .where(eq(taskPools.id, params.data.id))
        .returning()
      if (!pool) return null
      await tx
        .delete(taskPoolTemplates)
        .where(eq(taskPoolTemplates.poolId, pool.id))
      await tx
        .insert(taskPoolTemplates)
        .values(
          valid.uniqueIds.map((templateId) => ({
            poolId: pool.id,
            templateId,
          })),
        )
      return { ...pool, templates: valid.templates }
    })
    if (!updated) return failure("NOT_FOUND", "随机任务池不存在", 404)
    await writeAuditLog({
      actor,
      action: "UPDATE",
      actionLabel: "编辑随机任务池",
      entityType: "task_pool",
      entityId: updated.id,
      detail: { name: updated.name, templateCount: valid.uniqueIds.length },
    })
    return success(updated)
  } catch (error) {
    console.error("[API task-pools PUT]", error)
    return failure("INTERNAL_ERROR", "更新随机任务池失败", 500)
  }
}

export async function DELETE(_: NextRequest, context: RouteContext) {
  const actor = await getAdminUser()
  if (!actor) return failure("FORBIDDEN", "仅管理员可管理随机任务池", 403)
  const params = ParamsSchema.safeParse(await context.params)
  if (!params.success) return failure("VALIDATION_ERROR", "参数不合法", 400)
  try {
    const result = await db.transaction(async (tx) => {
      const affectedRules = await tx
        .update(rules)
        .set({ taskPoolId: null, enabled: false, updatedAt: new Date() })
        .where(eq(rules.taskPoolId, params.data.id))
        .returning({ id: rules.id })
      const [deleted] = await tx
        .delete(taskPools)
        .where(eq(taskPools.id, params.data.id))
        .returning({ id: taskPools.id, name: taskPools.name })
      return { deleted, affectedRuleCount: affectedRules.length }
    })
    if (!result.deleted) return failure("NOT_FOUND", "随机任务池不存在", 404)
    await writeAuditLog({
      actor,
      action: "DELETE",
      actionLabel: "删除随机任务池",
      entityType: "task_pool",
      entityId: result.deleted.id,
      detail: {
        name: result.deleted.name,
        affectedRuleCount: result.affectedRuleCount,
      },
    })
    return success({
      id: result.deleted.id,
      affectedRuleCount: result.affectedRuleCount,
    })
  } catch (error) {
    console.error("[API task-pools DELETE]", error)
    return failure("INTERNAL_ERROR", "删除随机任务池失败", 500)
  }
}
