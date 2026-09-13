import { sql } from "drizzle-orm"
import { z } from "zod"
import { failure, success } from "@/lib/api-response"
import { getAdminUser } from "@/lib/admin-api"
import { writeAuditLog } from "@/lib/audit"
import { db } from "@/lib/db"
import { securityMailOutbox, securityMailSettings } from "@/lib/db/schema"
import { getSecurityMailConfig, maskSecurityEmail } from "@/lib/security-mail"
import { getSecurityMailPolicy } from "@/lib/security-mail-server"

export async function GET() {
  if (!(await getAdminUser()))
    return failure("FORBIDDEN", "仅管理员可查看邮件服务设置", 403)
  try {
    const config = getSecurityMailConfig()
    const [counts] = await db
      .select({
        pending: sql<number>`count(*) filter (where ${securityMailOutbox.sentAt} is null and ${securityMailOutbox.attempts} < 5)::int`,
        failed: sql<number>`count(*) filter (where ${securityMailOutbox.sentAt} is null and ${securityMailOutbox.attempts} >= 5)::int`,
        sent: sql<number>`count(*) filter (where ${securityMailOutbox.sentAt} is not null)::int`,
      })
      .from(securityMailOutbox)
    return success({
      ...(await getSecurityMailPolicy()),
      provider: "腾讯云 SES API",
      region: config.region,
      sender: config.from ? maskSecurityEmail(config.from) : null,
      ...counts,
    })
  } catch {
    return failure(
      "INTERNAL_ERROR",
      "读取邮件设置失败，请确认数据库已升级",
      500,
    )
  }
}
export async function PUT(request: Request) {
  const actor = await getAdminUser()
  if (!actor) return failure("FORBIDDEN", "仅管理员可修改邮件服务设置", 403)
  const parsed = z
    .object({ bindingEnabled: z.boolean() })
    .strict()
    .safeParse(await request.json().catch(() => null))
  if (!parsed.success) return failure("VALIDATION_ERROR", "设置格式不正确", 400)
  if (parsed.data.bindingEnabled && !getSecurityMailConfig().configured)
    return failure(
      "VALIDATION_ERROR",
      "请先配置腾讯云 SES 凭据、地域、发信地址及两个邮件模板 ID",
      400,
    )
  try {
    await db.transaction(async (tx) => {
      await tx
        .insert(securityMailSettings)
        .values({ id: "default", ...parsed.data })
        .onConflictDoUpdate({
          target: securityMailSettings.id,
          set: parsed.data,
        })
      await writeAuditLog(
        {
          actor,
          action: "UPDATE",
          actionLabel: "更新安全邮箱绑定策略",
          entityType: "security_mail_settings",
          detail: parsed.data,
        },
        tx,
      )
    })
    return success(parsed.data)
  } catch {
    return failure("INTERNAL_ERROR", "保存邮件设置失败", 500)
  }
}
