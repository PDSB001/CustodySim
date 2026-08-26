import { eq } from "drizzle-orm"
import { NextRequest } from "next/server"
import { z } from "zod"

import { failure, success } from "@/lib/api-response"
import { getAdminUser } from "@/lib/admin-api"
import { db } from "@/lib/db"
import { reportTemplates, rules } from "@/lib/db/schema"

const Params = z.object({ id: z.string().uuid() })

export async function DELETE(
  _: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  if (!(await getAdminUser()))
    return failure("FORBIDDEN", "仅管理员可管理任务模板", 403)

  const params = Params.safeParse(await context.params)
  if (!params.success) return failure("VALIDATION_ERROR", "参数不合法", 400)

  try {
    const templateId = params.data.id
    const [template] = await db
      .select({ id: reportTemplates.id })
      .from(reportTemplates)
      .where(eq(reportTemplates.id, templateId))
      .limit(1)

    if (!template) return failure("NOT_FOUND", "任务表单模板不存在", 404)

    const unboundRules = await db.transaction(async (tx) => {
      const affectedRules = await tx
        .update(rules)
        .set({ templateId: null, updatedAt: new Date() })
        .where(eq(rules.templateId, templateId))
        .returning({ id: rules.id })

      await tx.delete(reportTemplates).where(eq(reportTemplates.id, templateId))
      return affectedRules
    })

    return success({ id: templateId, unboundRuleCount: unboundRules.length })
  } catch (error) {
    console.error("[API report-templates DELETE]", error)
    return failure("INTERNAL_ERROR", "服务器错误", 500)
  }
}
