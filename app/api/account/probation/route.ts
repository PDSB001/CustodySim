import { eq } from "drizzle-orm"
import { success, failure } from "@/lib/api-response"
import { db } from "@/lib/db"
import { registrations } from "@/lib/db/schema"
import { getSessionUser } from "@/lib/session"
import { probationScore } from "@/lib/registration-server"
export async function GET() {
  const user = await getSessionUser()
  if (!user) return failure("UNAUTHORIZED", "请先登录", 401)
  const [entry] = await db
    .select()
    .from(registrations)
    .where(eq(registrations.userId, user.id))
  return success(
    entry
      ? {
          state: entry.state,
          trialStart: entry.trialStart,
          trialEnd: entry.trialEnd,
          score:
            entry.finalScore ??
            (await probationScore(user.id, entry.trialStart, entry.trialEnd)),
          evaluatedAt: entry.evaluatedAt,
        }
      : null,
  )
}
