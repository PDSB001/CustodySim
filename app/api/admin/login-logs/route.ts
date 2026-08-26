import { desc } from "drizzle-orm"

import { failure, success } from "@/lib/api-response"
import { getAdminUser } from "@/lib/admin-api"
import { db } from "@/lib/db"
import { loginLogs } from "@/lib/db/schema"

export async function GET() {
  const actor = await getAdminUser()
  if (!actor) return failure("FORBIDDEN", "仅管理员可查看登录日志", 403)
  return success(
    await db
      .select()
      .from(loginLogs)
      .orderBy(desc(loginLogs.createdAt))
      .limit(200),
  )
}
