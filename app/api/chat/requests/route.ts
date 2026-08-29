import { desc, eq, or } from "drizzle-orm"

import { failure, success } from "@/lib/api-response"
import { getChatUserSummary } from "@/lib/chat-server"
import { db } from "@/lib/db"
import { chatDirectRequests } from "@/lib/db/schema"
import { getSessionUser } from "@/lib/session"

export async function GET() {
  const actor = await getSessionUser()
  if (!actor) return failure("UNAUTHORIZED", "请先登录", 401)
  try {
    const rows =
      actor.role === "ADMIN"
        ? await db
            .select()
            .from(chatDirectRequests)
            .orderBy(desc(chatDirectRequests.createdAt))
        : actor.role === "SUPERVISED"
          ? await db
              .select()
              .from(chatDirectRequests)
              .where(
                or(
                  eq(chatDirectRequests.requesterId, actor.id),
                  eq(chatDirectRequests.targetId, actor.id),
                ),
              )
              .orderBy(desc(chatDirectRequests.createdAt))
          : []
    const result = await Promise.all(
      rows.map(async (row) => {
        const [requester, target, reviewer] = await Promise.all([
          getChatUserSummary(row.requesterId),
          getChatUserSummary(row.targetId),
          row.reviewedBy ? getChatUserSummary(row.reviewedBy) : null,
        ])
        return {
          ...row,
          requesterName: requester?.name ?? "未知用户",
          targetName: target?.name ?? "未知用户",
          reviewerName: reviewer?.name ?? null,
          reviewedAt: row.reviewedAt?.toISOString() ?? null,
          createdAt: row.createdAt.toISOString(),
          updatedAt: row.updatedAt.toISOString(),
        }
      }),
    )
    return success(result)
  } catch (error) {
    console.error("[API chat requests GET]", error)
    return failure("INTERNAL_ERROR", "获取私聊申请失败", 500)
  }
}
