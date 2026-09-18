import { eq } from "drizzle-orm"
import { NextRequest } from "next/server"

import { failure, success } from "@/lib/api-response"
import { db } from "@/lib/db"
import { uiConfigs } from "@/lib/db/schema"
import { getSessionUser } from "@/lib/session"
import { UI_CONFIG_DEFAULTS as DEFAULTS } from "@/lib/ui-config-defaults"

export async function GET(request: NextRequest) {
  const user = await getSessionUser()
  if (!user) return failure("UNAUTHORIZED", "请先登录", 401)
  const scope = request.nextUrl.searchParams.get("scope") ?? user.role
  if (!["SUPERVISOR", "SUPERVISED"].includes(scope))
    return failure("VALIDATION_ERROR", "无效的 scope", 400)
  const [config] = await db
    .select()
    .from(uiConfigs)
    .where(eq(uiConfigs.scope, scope))
    .limit(1)
  return success({
    scope,
    homeTitle: config?.homeTitle ?? DEFAULTS[scope].homeTitle,
    homeSubtitle: config?.homeSubtitle ?? DEFAULTS[scope].homeSubtitle,
    homeBanner: config?.homeBanner ?? DEFAULTS[scope].homeBanner,
  })
}
