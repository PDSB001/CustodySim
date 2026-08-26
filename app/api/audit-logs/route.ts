import { desc } from "drizzle-orm"

import { failure, success } from "@/lib/api-response"
import { getAdminUser } from "@/lib/admin-api"
import { db } from "@/lib/db"
import { auditLogs } from "@/lib/db/schema"

export async function GET() {
  const actor = await getAdminUser()
  if (!actor) return failure("FORBIDDEN", "仅管理员可查看审计日志", 403)
  return success(
    await db
      .select()
      .from(auditLogs)
      .orderBy(desc(auditLogs.createdAt))
      .limit(200),
  )
}
