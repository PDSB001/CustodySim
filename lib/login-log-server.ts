import { loginLogs } from "@/lib/db/schema"
import { db } from "@/lib/db"

export async function writeLoginLog({
  userId,
  username,
  success,
  failReason,
  ip,
  userAgent,
}: {
  userId?: string | null
  username: string
  success: boolean
  failReason?: string
  ip?: string | null
  userAgent?: string | null
}) {
  await db.insert(loginLogs).values({
    userId: userId ?? null,
    username,
    success,
    failReason,
    ip: ip ?? null,
    userAgent: userAgent ?? null,
  })
}
