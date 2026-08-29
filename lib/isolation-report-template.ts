import { and, asc, eq } from "drizzle-orm"
import { db } from "@/lib/db"
import { reportTemplateFields, reportTemplates } from "@/lib/db/schema"

export const ISOLATION_REPORT_TEMPLATE_NAME = "禁闭期间每日检讨"

export async function ensureIsolationReportTemplate() {
  return db.transaction(async (tx) => {
    const [existing] = await tx.select().from(reportTemplates).where(and(eq(reportTemplates.name, ISOLATION_REPORT_TEMPLATE_NAME), eq(reportTemplates.kind, "REPORT"))).limit(1)
    const template = existing ?? (await tx.insert(reportTemplates).values({ name: ISOLATION_REPORT_TEMPLATE_NAME, kind: "REPORT", content: "请如实复盘当日行为，说明问题、影响与次日具体改进计划。" }).returning())[0]
    if (!template) throw new Error("创建禁闭任务模板失败")
    if (!existing) await tx.insert(reportTemplateFields).values([
      { templateId: template.id, name: "当日检讨", type: "TEXTAREA", required: true, options: [], sort: 0 },
      { templateId: template.id, name: "改进计划", type: "TEXTAREA", required: true, options: [], sort: 1 },
    ])
    const fields = await tx.select({ name: reportTemplateFields.name, type: reportTemplateFields.type, required: reportTemplateFields.required, options: reportTemplateFields.options }).from(reportTemplateFields).where(eq(reportTemplateFields.templateId, template.id)).orderBy(asc(reportTemplateFields.sort))
    return { ...template, fields }
  })
}
