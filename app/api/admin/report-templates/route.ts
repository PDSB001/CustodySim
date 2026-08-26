import { asc } from "drizzle-orm"
import { NextRequest } from "next/server"

import { failure, success } from "@/lib/api-response"
import { getAdminUser } from "@/lib/admin-api"
import { ReportTemplateSchema } from "@/lib/admin-schemas"
import { db } from "@/lib/db"
import { reportTemplateFields, reportTemplates } from "@/lib/db/schema"

export async function GET() {
  if (!(await getAdminUser()))
    return failure("FORBIDDEN", "仅管理员可查看任务模板", 403)
  const [templates, fields] = await Promise.all([
    db.select().from(reportTemplates).orderBy(asc(reportTemplates.createdAt)),
    db.select().from(reportTemplateFields),
  ])
  return success(
    templates.map((template) => ({
      ...template,
      fields: fields.filter((field) => field.templateId === template.id),
    })),
  )
}

export async function POST(request: NextRequest) {
  if (!(await getAdminUser()))
    return failure("FORBIDDEN", "仅管理员可管理任务模板", 403)
  const parsed = ReportTemplateSchema.safeParse(await request.json())
  if (!parsed.success)
    return failure(
      "VALIDATION_ERROR",
      JSON.stringify(parsed.error.flatten().fieldErrors),
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
