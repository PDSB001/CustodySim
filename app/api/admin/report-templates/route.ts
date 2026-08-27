import { asc } from "drizzle-orm"
import { NextRequest } from "next/server"

import { writeAuditLog } from "@/lib/audit"
import { getAdminUser } from "@/lib/admin-api"
import { ReportTemplateSchema } from "@/lib/admin-schemas"
import { failure, success } from "@/lib/api-response"
import { db } from "@/lib/db"
import { reportTemplateFields, reportTemplates } from "@/lib/db/schema"
import {
  ELECTRONIC_FENCE_REPORT_TEMPLATE_NAME,
  ensureElectronicFenceReportTemplate,
} from "@/lib/electronic-fence-report-template"

export async function GET() {
  try {
    if (!(await getAdminUser()))
      return failure("FORBIDDEN", "仅管理员可查看任务模板", 403)

    await ensureElectronicFenceReportTemplate()
    // Read both tables from one transaction snapshot. This prevents a
    // concurrent template edit from returning a partially updated list.
    const result = await db.transaction(async (tx) => {
      const [templates, fields] = await Promise.all([
        tx.select().from(reportTemplates).orderBy(asc(reportTemplates.createdAt)),
        tx
          .select()
          .from(reportTemplateFields)
          .orderBy(asc(reportTemplateFields.sort)),
      ])
      return templates.map((template) => ({
        ...template,
        fields: fields.filter((field) => field.templateId === template.id),
      }))
    })
    return success(result)
  } catch (error) {
    console.error("[API report-templates GET]", error)
    return failure("INTERNAL_ERROR", "服务器错误", 500)
  }
}

export async function POST(request: NextRequest) {
  const actor = await getAdminUser()
  if (!actor) return failure("FORBIDDEN", "仅管理员可管理任务模板", 403)
  const parsed = ReportTemplateSchema.safeParse(await request.json())
  if (!parsed.success)
    return failure(
      "VALIDATION_ERROR",
      JSON.stringify(parsed.error.flatten().fieldErrors),
      400,
    )
  if (parsed.data.name === ELECTRONIC_FENCE_REPORT_TEMPLATE_NAME)
    return failure(
      "VALIDATION_ERROR",
      "电子围栏系统模板已存在，请直接编辑它。",
      400,
    )
  try {
    const [template] = await db
      .insert(reportTemplates)
      .values({
        name: parsed.data.name,
        kind: parsed.data.kind,
        content: parsed.data.content ?? null,
      })
      .returning()
    if (!template) return failure("INTERNAL_ERROR", "创建模板失败", 500)
    const fields = await db
      .insert(reportTemplateFields)
      .values(
        parsed.data.fields.map((field, sort) => ({
          ...field,
          templateId: template.id,
          sort,
        })),
      )
      .returning()
    await writeAuditLog({
      actor,
      action: "CREATE",
      actionLabel: "创建任务模板",
      entityType: "report_template",
      entityId: template.id,
      detail: { name: template.name, kind: template.kind },
    })
    return success(
      {
        ...template,
        fields: fields.map((field) => ({
          id: field.id,
          name: field.name,
          type: field.type,
          required: field.required,
          options: field.options,
        })),
      },
      { status: 201 },
    )
  } catch (error) {
    console.error("[API report-templates POST]", error)
    return failure("INTERNAL_ERROR", "服务器错误", 500)
  }
}
