import { eq } from "drizzle-orm"
import { NextRequest } from "next/server"
import { z } from "zod"

import { failure, success } from "@/lib/api-response"
import { writeAuditLog } from "@/lib/audit"
import { getAdminUser } from "@/lib/admin-api"
import { ReportTemplateSchema } from "@/lib/admin-schemas"
import { db } from "@/lib/db"
import { reportTemplateFields, reportTemplates, rules } from "@/lib/db/schema"
import { ELECTRONIC_FENCE_REPORT_TEMPLATE_NAME } from "@/lib/electronic-fence-report-template"

const Params = z.object({ id: z.string().uuid() })

export async function PUT(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const actor = await getAdminUser()
  if (!actor) return failure("FORBIDDEN", "仅管理员可管理任务模板", 403)

  const params = Params.safeParse(await context.params)
  if (!params.success) return failure("VALIDATION_ERROR", "参数不合法", 400)
  const parsed = ReportTemplateSchema.safeParse(await request.json())
  if (!parsed.success)
    return failure(
      "VALIDATION_ERROR",
      JSON.stringify(parsed.error.flatten().fieldErrors),
      400,
    )

  const [current] = await db
    .select({ name: reportTemplates.name })
    .from(reportTemplates)
    .where(eq(reportTemplates.id, params.data.id))
    .limit(1)
  if (!current) return failure("NOT_FOUND", "任务表单模板不存在", 404)
  if (
    current.name !== ELECTRONIC_FENCE_REPORT_TEMPLATE_NAME &&
    parsed.data.name === ELECTRONIC_FENCE_REPORT_TEMPLATE_NAME
  )
    return failure(
      "VALIDATION_ERROR",
      "电子围栏系统模板已存在，请直接编辑它。",
      400,
    )

  try {
    const result = await db.transaction(async (tx) => {
      const [template] = await tx
        .update(reportTemplates)
        .set({
          name:
            current.name === ELECTRONIC_FENCE_REPORT_TEMPLATE_NAME
              ? current.name
              : parsed.data.name,
          kind:
            current.name === ELECTRONIC_FENCE_REPORT_TEMPLATE_NAME
              ? "REPORT"
              : parsed.data.kind,
          content: parsed.data.content ?? null,
          updatedAt: new Date(),
        })
        .where(eq(reportTemplates.id, params.data.id))
        .returning()
      if (!template) return null

      await tx
        .delete(reportTemplateFields)
        .where(eq(reportTemplateFields.templateId, template.id))
      const fields = await tx
        .insert(reportTemplateFields)
        .values(
          parsed.data.fields.map((field, sort) => ({
            ...field,
            templateId: template.id,
            sort,
          })),
        )
        .returning()
      return { ...template, fields }
    })

    if (!result) return failure("NOT_FOUND", "任务表单模板不存在", 404)
    await writeAuditLog({
      actor,
      action: "UPDATE",
      actionLabel: "编辑任务模板",
      entityType: "report_template",
      entityId: result.id,
      detail: { name: result.name, kind: result.kind },
    })
    return success(result)
  } catch (error) {
    console.error("[API report-templates PUT]", error)
    return failure("INTERNAL_ERROR", "更新任务模板失败", 500)
  }
}

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
      .select({ id: reportTemplates.id, name: reportTemplates.name })
      .from(reportTemplates)
      .where(eq(reportTemplates.id, templateId))
      .limit(1)

    if (!template) return failure("NOT_FOUND", "任务表单模板不存在", 404)
    if (template.name === ELECTRONIC_FENCE_REPORT_TEMPLATE_NAME)
      return failure(
        "VALIDATION_ERROR",
        "电子围栏系统模板不可删除；如需调整，请直接编辑模板内容。",
        400,
      )

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
