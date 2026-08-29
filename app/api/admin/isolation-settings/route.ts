import { asc, eq } from "drizzle-orm"
import { NextRequest } from "next/server"

import { getAdminUser } from "@/lib/admin-api"
import { failure, success } from "@/lib/api-response"
import { writeAuditLog } from "@/lib/audit"
import { db } from "@/lib/db"
import { isolationSettings, reportTemplates } from "@/lib/db/schema"
import { z } from "zod"
import { ensureIsolationReportTemplate } from "@/lib/isolation-report-template"

const SettingsSchema = z.object({
  templateId: z.string().uuid().nullable(),
  scheduleTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  timeoutMinutes: z.coerce.number().int().min(1).max(10080),
})

export async function GET() {
  if (!(await getAdminUser())) return failure("FORBIDDEN", "仅管理员可查看禁闭设置", 403)
  try {
    const defaultTemplate = await ensureIsolationReportTemplate()
    const [settings] = await db.select().from(isolationSettings).where(eq(isolationSettings.id, "default")).limit(1)
    const templates = await db.select({ id: reportTemplates.id, name: reportTemplates.name, kind: reportTemplates.kind }).from(reportTemplates).where(eq(reportTemplates.kind, "REPORT")).orderBy(asc(reportTemplates.createdAt))
    return success({ settings: settings ?? { templateId: defaultTemplate.id, scheduleTime: "19:00", timeoutMinutes: 240 }, templates })
  } catch (error) {
    console.error("[API isolation-settings GET]", error)
    return failure("INTERNAL_ERROR", "服务器错误", 500)
  }
}

export async function PUT(request: NextRequest) {
  const actor = await getAdminUser()
  if (!actor) return failure("FORBIDDEN", "仅管理员可修改禁闭设置", 403)
  const parsed = SettingsSchema.safeParse(await request.json())
  if (!parsed.success) return failure("VALIDATION_ERROR", JSON.stringify(parsed.error.flatten().fieldErrors), 400)
  try {
    const [saved] = await db.insert(isolationSettings).values({ id: "default", ...parsed.data, updatedAt: new Date() }).onConflictDoUpdate({ target: isolationSettings.id, set: { ...parsed.data, updatedAt: new Date() } }).returning()
    if (!saved) return failure("INTERNAL_ERROR", "保存禁闭设置失败", 500)
    await writeAuditLog({ actor, action: "UPDATE", actionLabel: "更新禁闭设置", entityType: "isolation_settings", entityId: saved.id, detail: parsed.data })
    return success(saved)
  } catch (error) {
    console.error("[API isolation-settings PUT]", error)
    return failure("INTERNAL_ERROR", "服务器错误", 500)
  }
}
