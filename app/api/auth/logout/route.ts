import { eq, sql } from "drizzle-orm"
import { z } from "zod"
import type { NextResponse } from "next/server"

import { failure, success } from "@/lib/api-response"
import { clearAuthCookie, clearMfaChallengeCookie } from "@/lib/auth-cookie"
import { writeAuditLog } from "@/lib/audit"
import { db } from "@/lib/db"
import { users } from "@/lib/db/schema"
import { getSessionUser } from "@/lib/session"

const LogoutResponseSchema = z.object({ loggedOut: z.literal(true) })

export async function POST() {
  let response: NextResponse = success(
    LogoutResponseSchema.parse({ loggedOut: true }),
  )
  // JWT 是无状态的；仅清除 cookie 无法阻止已泄露令牌继续使用到过期。
  // 递增 tokenVersion 使该账号既有会话立即失效（等价于“退出全部设备”）。
  try {
    const actor = await getSessionUser({ allowPasswordChange: true })
    if (actor)
      await db.transaction(async (tx) => {
        const [changed] = await tx
          .update(users)
          .set({
            tokenVersion: sql`${users.tokenVersion} + 1`,
            updatedAt: new Date(),
          })
          .where(eq(users.id, actor.id))
          .returning({ id: users.id })
        if (!changed) return
        await writeAuditLog(
          {
            actor,
            action: "LOGOUT",
            actionLabel: "退出登录",
            entityType: "user",
            entityId: actor.id,
          },
          tx,
        )
      })
  } catch (error) {
    console.error("[API auth/logout]", error)
    response = failure(
      "INTERNAL_ERROR",
      "未能退出全部设备，请重新登录后重试",
      500,
    )
  }
  clearAuthCookie(response)
  clearMfaChallengeCookie(response)
  // 信任设备 cookie 有意保留：它代表用户此前对"本设备 30 天内免核验"的授权，
  // 退出登录只应结束本次会话，不应撤销该授权（撤销入口在安全设置页的设备列表）。
  return response
}
