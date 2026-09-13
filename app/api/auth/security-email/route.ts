import { eq } from "drizzle-orm"
import { failure, success } from "@/lib/api-response"
import { db } from "@/lib/db"
import { securityEmails } from "@/lib/db/schema"
import { decryptMfaSecret } from "@/lib/mfa"
import { maskSecurityEmail } from "@/lib/security-mail"
import { getSecurityMailPolicy } from "@/lib/security-mail-server"
import { getSessionUser } from "@/lib/session"

export async function GET() {
  const user = await getSessionUser()
  if (!user) return failure("UNAUTHORIZED", "请先登录", 401)
  try {
    const [email] = await db
      .select()
      .from(securityEmails)
      .where(eq(securityEmails.userId, user.id))
    return success({
      ...(await getSecurityMailPolicy()),
      maskedEmail: email
        ? maskSecurityEmail(decryptMfaSecret(email.emailEncrypted))
        : null,
      verifiedAt: email?.verifiedAt ?? null,
    })
  } catch {
    return failure(
      "INTERNAL_ERROR",
      "读取邮箱设置失败，请确认数据库已升级",
      500,
    )
  }
}
