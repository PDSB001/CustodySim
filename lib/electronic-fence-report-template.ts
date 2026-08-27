import { and, asc, eq, inArray, sql } from "drizzle-orm"

import { db } from "@/lib/db"
import {
  reportTasks,
  reportTemplateFields,
  reportTemplates,
  rules,
} from "@/lib/db/schema"

export const ELECTRONIC_FENCE_REPORT_TEMPLATE_NAME = "电子围栏越界说明"

const defaultFields = [
  { name: "越界原因", type: "TEXTAREA", required: true, options: [] },
  { name: "预计返回时间", type: "DATE", required: false, options: [] },
]

/** 确保围栏任务有一份可在“任务表单”中查看和编辑的默认模板。 */
export async function ensureElectronicFenceReportTemplate() {
  return db.transaction(async (tx) => {
    // 多个浏览器或多个服务实例同时首访时，也只能产生一份系统模板。
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${ELECTRONIC_FENCE_REPORT_TEMPLATE_NAME}))`,
    )
    const matches = await tx
      .select()
      .from(reportTemplates)
      .where(
        and(
          eq(reportTemplates.name, ELECTRONIC_FENCE_REPORT_TEMPLATE_NAME),
          eq(reportTemplates.kind, "REPORT"),
        ),
      )
      .orderBy(asc(reportTemplates.createdAt))

    const [existing, ...duplicates] = matches
    let template = existing
    if (template) {
      if (duplicates.length) {
        const duplicateIds = duplicates.map((item) => item.id)
        const now = new Date()
        await tx
          .update(reportTasks)
          .set({ templateId: existing.id, updatedAt: now })
          .where(inArray(reportTasks.templateId, duplicateIds))
        await tx
          .update(rules)
          .set({ templateId: existing.id, updatedAt: now })
          .where(inArray(rules.templateId, duplicateIds))
        await tx
          .delete(reportTemplateFields)
          .where(inArray(reportTemplateFields.templateId, duplicateIds))
        await tx
          .delete(reportTemplates)
          .where(inArray(reportTemplates.id, duplicateIds))
      }
    } else {
      const [created] = await tx
        .insert(reportTemplates)
        .values({
          name: ELECTRONIC_FENCE_REPORT_TEMPLATE_NAME,
          kind: "REPORT",
          content:
            "系统判定发生电子围栏越界。请如实说明原因，并填写预计返回时间后提交审核。",
        })
        .returning()
      if (!created) throw new Error("创建电子围栏任务模板失败")
      template = created
      await tx.insert(reportTemplateFields).values(
        defaultFields.map((field, sort) => ({
          ...field,
          templateId: created.id,
          sort,
        })),
      )
    }
    const fields = await tx
      .select({
        name: reportTemplateFields.name,
        type: reportTemplateFields.type,
        required: reportTemplateFields.required,
        options: reportTemplateFields.options,
      })
      .from(reportTemplateFields)
      .where(eq(reportTemplateFields.templateId, template.id))
      .orderBy(asc(reportTemplateFields.sort))

    return { ...template, fields }
  })
}
