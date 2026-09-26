import { eq } from "drizzle-orm"
import { cookies, headers } from "next/headers"

import { verifyToken } from "@/lib/auth"
import { AUTH_COOKIE_NAME, type Role } from "@/lib/constants"
import { db } from "@/lib/db"
import { users } from "@/lib/db/schema"

export type SessionUser = {
  id: string
  username: string
  name: string
  role: Role
  organizationId: string | null
  mustChangePassword: boolean
  avatar?: string | null
}

/**
 * 读取请求携带的会话令牌。
 *
 * 浏览器用 httpOnly cookie（XSS 拿不到令牌）；原生客户端用
 * `Authorization: Bearer <JWT>`。一旦带了 Authorization 头就只认它、不回退
 * cookie，避免两个来源不一致时出现"到底以哪个身份执行"的歧义。
 */
async function readSessionToken() {
  const headerStore = await headers()
  const authorization = headerStore.get("authorization")
  if (authorization?.startsWith("Bearer ")) {
    const value = authorization.slice("Bearer ".length).trim()
    if (value) return value
  }
  const cookieStore = await cookies()
  return cookieStore.get(AUTH_COOKIE_NAME)?.value ?? null
}

export async function getSessionUser(
  options: { allowPasswordChange?: boolean } = {},
): Promise<SessionUser | null> {
  const token = await readSessionToken()
  if (!token) return null
  const payload = await verifyToken(token)
  if (!payload) return null
  const [user] = await db
    .select({
      id: users.id,
      username: users.username,
      name: users.name,
      avatar: users.avatar,
      role: users.role,
      organizationId: users.organizationId,
      mustChangePassword: users.mustChangePassword,
      tokenVersion: users.tokenVersion,
      status: users.status,
    })
    .from(users)
    .where(eq(users.id, payload.userId))
    .limit(1)
  if (
    !user ||
    user.status !== "active" ||
    user.tokenVersion !== payload.tokenVersion ||
    !["ADMIN", "SUPERVISOR", "SUPERVISED"].includes(user.role)
  )
    return null
  if (user.mustChangePassword && !options.allowPasswordChange) return null
  return {
    id: user.id,
    username: user.username,
    name: user.name,
    avatar: user.avatar,
    role: user.role as Role,
    organizationId: user.organizationId,
    mustChangePassword: user.mustChangePassword,
  }
}
