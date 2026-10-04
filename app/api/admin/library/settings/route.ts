import { z } from "zod"
import { db } from "@/lib/db"
import { libraryScoreSettings } from "@/lib/db/schema"
import { getAdminUser } from "@/lib/admin-api"
import { writeAuditLog } from "@/lib/audit"
import { failure, success } from "@/lib/api-response"

const Settings = z.object({
  enabled: z.boolean(),
  minutesPerPoint: z.number().int().min(1).max(1440),
  dailyCap: z.number().int().min(1).max(3),
})
export async function GET() {
  if (!(await getAdminUser()))
    return failure("FORBIDDEN", "仅管理员可管理阅读积分", 403)
  const [settings] = await db.select().from(libraryScoreSettings)
  return success(
    settings ?? { enabled: true, minutesPerPoint: 15, dailyCap: 3 },
  )
}
export async function PUT(request: Request) {
  const actor = await getAdminUser()
  if (!actor) return failure("FORBIDDEN", "仅管理员可管理阅读积分", 403)
  const parsed = Settings.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return failure("VALIDATION_ERROR", "积分配置不合法", 400)
  const [settings] = await db
    .insert(libraryScoreSettings)
    .values({ id: 1, ...parsed.data })
    .onConflictDoUpdate({ target: libraryScoreSettings.id, set: parsed.data })
    .returning()
  await writeAuditLog({
    actor,
    action: "UPDATE",
    actionLabel: "调整阅读积分规则",
    entityType: "library_score_settings",
    detail: parsed.data,
  })
  return success(settings)
}
