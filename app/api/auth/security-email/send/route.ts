import { z } from "zod"
import { failure, success } from "@/lib/api-response"
import { getRequestIp } from "@/lib/admin-api"
import { SecurityEmailSchema } from "@/lib/security-mail"
import {
  beginEmailBinding,
  EmailSecurityError,
} from "@/lib/security-mail-server"
import { getSessionUser } from "@/lib/session"

const Input = z
  .object({
    email: SecurityEmailSchema,
    password: z.string().min(1).max(128),
    code: z.string().trim().max(32).optional(),
  })
  .strict()
export async function POST(request: Request) {
  const user = await getSessionUser()
  if (!user) return failure("UNAUTHORIZED", "请先登录", 401)
  const parsed = Input.safeParse(await request.json().catch(() => null))
  if (!parsed.success)
    return failure(
      "VALIDATION_ERROR",
      "请输入有效邮箱、当前密码和所需的验证器代码",
      400,
    )
  try {
    return success(
      await beginEmailBinding(
        user,
        parsed.data,
        getRequestIp(request.headers) ?? "unknown",
      ),
    )
  } catch (error) {
    if (error instanceof EmailSecurityError)
      return failure(
        error.status === 429 ? "RATE_LIMITED" : "VALIDATION_ERROR",
        error.message,
        error.status,
      )
    return failure("INTERNAL_ERROR", "邮箱验证请求失败", 500)
  }
}
