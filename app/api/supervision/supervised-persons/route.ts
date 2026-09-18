import { and, asc, eq, inArray } from "drizzle-orm"

import { failure, success } from "@/lib/api-response"
import { db } from "@/lib/db"
import { users } from "@/lib/db/schema"
import { getSessionUser } from "@/lib/session"
import { getSupervisedUserIdsForActor } from "@/lib/supervision-scope"

/**
 * 返回当前监管人监管范围内的在押人员名单（仅 id 与姓名）。
 *
 * 与打卡任务无关：轨迹回看需要能选到**所有**在范围内的人，包括当天没有点名任务、
 * 或规则停用的人。因此不能复用 `/api/supervision/checkins`（那是按任务返回的，
 * 同一个人会出现多行，且没有任务的人根本不在结果里）。
 */
export async function GET() {
  const actor = await getSessionUser()
  if (!actor) return failure("UNAUTHORIZED", "请先登录", 401)
  if (actor.role === "SUPERVISED")
    return failure("FORBIDDEN", "仅监管人或管理处可查看人员名单", 403)

  try {
    const ids = [...(await getSupervisedUserIdsForActor(actor))]
    if (!ids.length) return success([])
    const rows = await db
      .select({ id: users.id, name: users.name })
      .from(users)
      .where(
        and(
          inArray(users.id, ids),
          eq(users.role, "SUPERVISED"),
          eq(users.status, "active"),
        ),
      )
      .orderBy(asc(users.name))
    return success(rows)
  } catch (error) {
    console.error("[API supervision/supervised-persons]", error)
    return failure("INTERNAL_ERROR", "服务器错误", 500)
  }
}
