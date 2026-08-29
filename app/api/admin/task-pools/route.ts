import { asc, inArray } from "drizzle-orm"
import { NextRequest } from "next/server"

import { getAdminUser } from "@/lib/admin-api"
import { TaskPoolSchema } from "@/lib/admin-schemas"
import { failure, success } from "@/lib/api-response"
import { writeAuditLog } from "@/lib/audit"
import { db } from "@/lib/db"
import { reportTemplates, taskPools, taskPoolTemplates } from "@/lib/db/schema"

function serializePools(
  pools: Array<typeof taskPools.$inferSelect>,
  links: Array<typeof taskPoolTemplates.$inferSelect>,
  templates: Array<typeof reportTemplates.$inferSelect>,
) {
  return pools.map((pool) => ({
    ...pool,
    templates: links
      .filter((link) => link.poolId === pool.id)
      .map((link) =>
        templates.find((template) => template.id === link.templateId),
      )
      .filter((template): template is typeof reportTemplates.$inferSelect =>
        Boolean(template),
      ),
  }))
}

export async function GET() {
  if (!(await getAdminUser()))
    return failure("FORBIDDEN", "仅管理员可查看随机任务池", 403)
  try {
    const [pools, links, templates] = await Promise.all([
      db.select().from(taskPools).orderBy(asc(taskPools.createdAt)),
      db.select().from(taskPoolTemplates),
      db.select().from(reportTemplates),
    ])
    return success(serializePools(pools, links, templates))
  } catch (error) {
    console.error("[API task-pools GET]", error)
    return failure("INTERNAL_ERROR", "读取随机任务池失败", 500)
  }
}

export async function POST(request: NextRequest) {
  const actor = await getAdminUser()
  if (!actor) return failure("FORBIDDEN", "仅管理员可管理随机任务池", 403)
  const parsed = TaskPoolSchema.safeParse(await request.json())
  if (!parsed.success)
    return failure(
      "VALIDATION_ERROR",
      JSON.stringify(parsed.error.flatten().fieldErrors),
      400,
    )
  const templateIds = [...new Set(parsed.data.templateIds)]
  try {
    const templates = await db
      .select()
      .from(reportTemplates)
      .where(inArray(reportTemplates.id, templateIds))
    if (templates.length !== templateIds.length)
      return failure("VALIDATION_ERROR", "所选任务模板不存在", 400)
    if (templates.some((template) => template.kind !== parsed.data.kind))
      return failure("VALIDATION_ERROR", "任务池只能包含同一类型的模板", 400)
    const created = await db.transaction(async (tx) => {
      const [pool] = await tx
        .insert(taskPools)
        .values({
          name: parsed.data.name,
          kind: parsed.data.kind,
          enabled: parsed.data.enabled,
        })
        .returning()
      if (!pool) return null
      await tx
        .insert(taskPoolTemplates)
        .values(
          templateIds.map((templateId) => ({ poolId: pool.id, templateId })),
        )
      return { ...pool, templates }
    })
    if (!created) return failure("INTERNAL_ERROR", "创建随机任务池失败", 500)
    await writeAuditLog({
      actor,
      action: "CREATE",
      actionLabel: "创建随机任务池",
      entityType: "task_pool",
      entityId: created.id,
      detail: {
        name: created.name,
        kind: created.kind,
        templateCount: templateIds.length,
      },
    })
    return success(created, { status: 201 })
  } catch (error) {
    console.error("[API task-pools POST]", error)
    return failure("INTERNAL_ERROR", "创建随机任务池失败", 500)
  }
}
