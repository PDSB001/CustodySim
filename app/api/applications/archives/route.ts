import { desc, eq } from "drizzle-orm"

import { failure, success } from "@/lib/api-response"
import { db } from "@/lib/db"
import { profileForms, profileRecords } from "@/lib/db/schema"
import { getSessionUser } from "@/lib/session"

export async function GET() {
  const actor = await getSessionUser()
  if (!actor) return failure("UNAUTHORIZED", "请先登录", 401)
  if (actor.role !== "SUPERVISED")
    return failure("FORBIDDEN", "仅被监管人可查看个人档案", 403)
  try {
    const rows = await db
      .select({
        id: profileRecords.id,
        code: profileRecords.code,
        formName: profileForms.name,
        lockedAt: profileRecords.lockedAt,
      })
      .from(profileRecords)
      .innerJoin(profileForms, eq(profileForms.id, profileRecords.formId))
      .where(eq(profileRecords.userId, actor.id))
      .orderBy(desc(profileRecords.lockedAt))
    return success(rows.filter((row) => row.lockedAt))
  } catch (error) {
    console.error("[API applications archives GET]", error)
    return failure("INTERNAL_ERROR", "服务器错误", 500)
  }
}
