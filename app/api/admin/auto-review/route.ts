import { randomUUID } from "node:crypto"
import { and, asc, eq, inArray } from "drizzle-orm"
import { getAdminUser } from "@/lib/admin-api"
import { failure, success } from "@/lib/api-response"
import { writeAuditLog } from "@/lib/audit"
import {
  AutoReviewSettingsSchema,
  getAutoReviewSettings,
  isMissingAutoReviewTable,
} from "@/lib/auto-review-settings"
import { db } from "@/lib/db"
import {
  autoReviewRuns,
  autoReviewSettings,
  reportTemplates,
  users,
} from "@/lib/db/schema"
import { GLM_REVIEW_MODEL } from "@/lib/glm-review"
import { ISOLATION_REPORT_TEMPLATE_NAME } from "@/lib/isolation-report-template"

export async function GET() {
  if (!(await getAdminUser()))
    return failure("FORBIDDEN", "仅管理员可查看自动审核设置", 403)
  try {
    const [state, actors, templates] = await Promise.all([
      getAutoReviewSettings(),
      db
        .select({
          id: users.id,
          name: users.name,
          username: users.username,
          role: users.role,
        })
        .from(users)
        .where(
          and(
            eq(users.status, "active"),
            eq(users.mustChangePassword, false),
            inArray(users.role, ["ADMIN", "SUPERVISOR"]),
          ),
        )
        .orderBy(asc(users.name)),
      db
        .select({ id: reportTemplates.id, name: reportTemplates.name })
        .from(reportTemplates)
        .orderBy(asc(reportTemplates.name)),
    ])
    let storageReady = state.storageReady
    try {
      await db.select({ id: autoReviewRuns.id }).from(autoReviewRuns).limit(1)
    } catch (error) {
      if (!isMissingAutoReviewTable(error)) throw error
      storageReady = false
    }
    return success({
      ...state,
      storageReady,
      actors,
      templates: templates.map((t) => ({
        ...t,
        restricted: t.name === ISOLATION_REPORT_TEMPLATE_NAME,
      })),
      apiKeyConfigured: Boolean(process.env.GLM_API_KEY?.trim()),
      model: GLM_REVIEW_MODEL,
    })
  } catch {
    return failure("INTERNAL_ERROR", "读取自动审核设置失败", 500)
  }
}

class SettingsError extends Error {
  constructor(
    message: string,
    readonly status: number = 400,
  ) {
    super(message)
  }
}

export async function PUT(request: Request) {
  const actor = await getAdminUser()
  if (!actor) return failure("FORBIDDEN", "仅管理员可修改自动审核设置", 403)
  const parsed = AutoReviewSettingsSchema.safeParse(
    await request.json().catch(() => null),
  )
  if (!parsed.success) return failure("VALIDATION_ERROR", "设置格式不正确", 400)
  const { revision, ...values } = parsed.data
  try {
    const saved = await db.transaction(async (tx) => {
      // Serialize the initial insert as well as later edits; review transactions share this row lock.
      const inserted = await tx
        .insert(autoReviewSettings)
        .values({ id: "default" })
        .onConflictDoNothing()
        .returning({ id: autoReviewSettings.id })
      const [current] = await tx
        .select()
        .from(autoReviewSettings)
        .where(eq(autoReviewSettings.id, "default"))
        .for("update")
      if (revision !== null && revision !== current.revision)
        throw new SettingsError("设置已被其他管理员修改，请刷新后重试", 409)
      if (revision === null && !inserted.length)
        throw new SettingsError("设置已被其他管理员修改，请刷新后重试", 409)
      if (values.enabled) {
        if (!process.env.GLM_API_KEY?.trim())
          throw new SettingsError("请先在服务端配置 GLM_API_KEY")
        if (!values.actorId || !values.templateIds.length)
          throw new SettingsError("请选择审核账号和至少一个模板")
        const [reviewer] = await tx
          .select({ id: users.id })
          .from(users)
          .where(
            and(
              eq(users.id, values.actorId),
              eq(users.status, "active"),
              eq(users.mustChangePassword, false),
              inArray(users.role, ["ADMIN", "SUPERVISOR"]),
            ),
          )
          .for("share")
        if (!reviewer) throw new SettingsError("审核账号不可用，请重新选择")
        const templates = await tx
          .select({ name: reportTemplates.name })
          .from(reportTemplates)
          .where(inArray(reportTemplates.id, values.templateIds))
          .for("share")
        if (templates.length !== values.templateIds.length)
          throw new SettingsError("部分模板已删除，请重新选择")
        if (templates.some((t) => t.name === ISOLATION_REPORT_TEMPLATE_NAME))
          throw new SettingsError("禁闭检讨必须人工审核")
        await tx.select({ id: autoReviewRuns.id }).from(autoReviewRuns).limit(1)
      }
      const [row] = await tx
        .update(autoReviewSettings)
        .set({ ...values, revision: randomUUID(), updatedAt: new Date() })
        .where(eq(autoReviewSettings.id, "default"))
        .returning()
      await writeAuditLog(
        {
          actor,
          action: "UPDATE",
          actionLabel: values.enabled ? "启用自动审核" : "关闭自动审核",
          entityType: "auto_review_settings",
          detail: {
            before: {
              enabled: current.enabled,
              actorId: current.actorId,
              templateIds: current.templateIds,
            },
            after: values,
          },
        },
        tx,
      )
      return { ...values, revision: row.revision }
    })
    return success(saved)
  } catch (error) {
    if (error instanceof SettingsError)
      return failure("VALIDATION_ERROR", error.message, error.status)
    if (isMissingAutoReviewTable(error))
      return failure("INTERNAL_ERROR", "请先完成自动审核数据库升级", 503)
    return failure("INTERNAL_ERROR", "保存自动审核设置失败", 500)
  }
}
