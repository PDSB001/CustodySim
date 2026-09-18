import { eq } from "drizzle-orm"

import { db } from "@/lib/db"
import { refreshTokens, users } from "@/lib/db/schema"
import {
  REFRESH_TOKEN_TTL_SECONDS,
  generateRefreshToken,
  hashRefreshToken,
} from "@/lib/refresh-token"

type RefreshMeta = {
  ip?: string | null
  userAgent?: string | null
}

/** 签发一枚新刷新令牌，返回明文（仅此一次可见，库里只留哈希）。 */
export async function issueRefreshToken(input: {
  userId: string
  tokenVersion: number
  ip?: string | null
  userAgent?: string | null
}) {
  const token = generateRefreshToken()
  await db.insert(refreshTokens).values({
    userId: input.userId,
    tokenHash: hashRefreshToken(token),
    tokenVersion: input.tokenVersion,
    expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_SECONDS * 1000),
    ip: input.ip ?? null,
    userAgent: input.userAgent?.slice(0, 100) ?? null,
  })
  return token
}

/**
 * 用刷新令牌换取新的访问令牌，同时轮换刷新令牌本身。
 *
 * 任一条件不满足都返回 null（调用方一律按"登录已过期"处理，不区分原因，
 * 避免把账号状态泄露给持有旧令牌的一方）：
 * - 令牌不存在 / 已轮换 / 已过期
 * - 账号被停用、角色非法
 * - 账号的 tokenVersion 已变化（登出、改密、启用或关闭 MFA、管理员重置密码）
 */
export async function rotateRefreshToken(token: string, meta: RefreshMeta) {
  const tokenHash = hashRefreshToken(token)
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(refreshTokens)
      .where(eq(refreshTokens.tokenHash, tokenHash))
      .limit(1)
      .for("update")
    if (!row || row.revokedAt || row.expiresAt <= new Date()) return null

    const [user] = await tx
      .select({
        id: users.id,
        username: users.username,
        name: users.name,
        role: users.role,
        organizationId: users.organizationId,
        mustChangePassword: users.mustChangePassword,
        tokenVersion: users.tokenVersion,
        status: users.status,
      })
      .from(users)
      .where(eq(users.id, row.userId))
      .limit(1)
    if (
      !user ||
      user.status !== "active" ||
      user.tokenVersion !== row.tokenVersion ||
      !["ADMIN", "SUPERVISOR", "SUPERVISED"].includes(user.role)
    )
      return null

    const nextToken = generateRefreshToken()
    const [created] = await tx
      .insert(refreshTokens)
      .values({
        userId: user.id,
        tokenHash: hashRefreshToken(nextToken),
        tokenVersion: user.tokenVersion,
        expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_SECONDS * 1000),
        ip: meta.ip ?? null,
        userAgent: meta.userAgent?.slice(0, 100) ?? null,
      })
      .returning({ id: refreshTokens.id })
    await tx
      .update(refreshTokens)
      .set({ revokedAt: new Date(), replacedById: created?.id ?? null })
      .where(eq(refreshTokens.id, row.id))

    return { user, refreshToken: nextToken }
  })
}
