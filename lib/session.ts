import { eq } from "drizzle-orm"
import { cookies } from "next/headers"

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
}

export async function getSessionUser(
  options: { allowPasswordChange?: boolean } = {},
): Promise<SessionUser | null> {
  const cookieStore = await cookies()
  const token = cookieStore.get(AUTH_COOKIE_NAME)?.value
  if (!token) return null
  const payload = await verifyToken(token)
  if (!payload) return null
  const [user] = await db
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
    role: user.role as Role,
    organizationId: user.organizationId,
    mustChangePassword: user.mustChangePassword,
  }
}
