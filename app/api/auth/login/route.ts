import { eq } from "drizzle-orm"
import { NextRequest } from "next/server"

import { success, failure } from "@/lib/api-response"
import { getRequestIp } from "@/lib/admin-api"
import { signToken, verifyPassword } from "@/lib/auth"
import { setAuthCookie } from "@/lib/auth-cookie"
import { LoginSchema, SessionUserSchema } from "@/lib/auth-schemas"
import { db } from "@/lib/db"
import { users } from "@/lib/db/schema"
import { writeLoginLog } from "@/lib/login-log-server"

export const runtime = "nodejs"

export async function POST(request: NextRequest) {
  try {
    const parsed = LoginSchema.safeParse(await request.json())
    if (!parsed.success)
      return failure(
        "VALIDATION_ERROR",
        JSON.stringify(parsed.error.flatten().fieldErrors),
        400,
      )

    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.username, parsed.data.username))
      .limit(1)
    if (
      !user ||
      user.status !== "active" ||
      !(await verifyPassword(parsed.data.password, user.passwordHash))
    ) {
      await writeLoginLog({
        username: parsed.data.username,
        success: false,
        failReason: "用户名或密码错误",
        ip: getRequestIp(request.headers),
        userAgent: request.headers.get("user-agent"),
      }).catch(() => undefined)
      return failure("UNAUTHORIZED", "用户名或密码错误", 401)
    }
    if (!["ADMIN", "SUPERVISOR", "SUPERVISED"].includes(user.role))
      return failure("INTERNAL_ERROR", "用户角色配置无效", 500)

    const sessionUser = SessionUserSchema.parse({
      id: user.id,
      username: user.username,
      name: user.name,
      role: user.role,
      organizationId: user.organizationId,
      mustChangePassword: user.mustChangePassword,
    })
    const token = await signToken({
      userId: user.id,
      tokenVersion: user.tokenVersion,
      role: sessionUser.role,
    })
    const response = success(sessionUser)
    setAuthCookie(response, token)
    await writeLoginLog({
      userId: user.id,
      username: user.username,
      success: true,
      ip: getRequestIp(request.headers),
      userAgent: request.headers.get("user-agent"),
    }).catch(() => undefined)
    return response
  } catch (error) {
    console.error("[API auth/login POST]", error)
    return failure("INTERNAL_ERROR", "服务器错误", 500)
  }
}
