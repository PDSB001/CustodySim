import { eq } from "drizzle-orm"
import { NextRequest } from "next/server"

import { failure, success } from "@/lib/api-response"
import { getAdminUser } from "@/lib/admin-api"
import { UiConfigSchema } from "@/lib/admin-schemas"
import { writeAuditLog } from "@/lib/audit"
import { db } from "@/lib/db"
import { uiConfigs } from "@/lib/db/schema"

const DEFAULTS = {
  SUPERVISOR: {
    homeTitle: "你好，{name}",
    homeSubtitle: "集中处理今日任务、打卡异常、补卡审核与执行汇报。",
    homeBanner: "",
  },
  SUPERVISED: {
    homeTitle: "你好，{name}",
    homeSubtitle: "查看今天需要完成的任务、打卡时段与通知，所有操作从这里开始。",
    homeBanner: "",
  },
}

export async function GET() {
  const actor = await getAdminUser()
  if (!actor) return failure("FORBIDDEN", "仅管理员可查看界面配置", 403)
  const configs = await db.select().from(uiConfigs)
  const result = (Object.keys(DEFAULTS) as Array<keyof typeof DEFAULTS>).map(
    (scope) => {
      const existing = configs.find((c) => c.scope === scope)
      return {
        scope,
        homeTitle: existing?.homeTitle ?? DEFAULTS[scope].homeTitle,
        homeSubtitle: existing?.homeSubtitle ?? DEFAULTS[scope].homeSubtitle,
        homeBanner: existing?.homeBanner ?? DEFAULTS[scope].homeBanner,
      }
    },
  )
  return success(result)
}

export async function PUT(request: NextRequest) {
  const actor = await getAdminUser()
  if (!actor) return failure("FORBIDDEN", "仅管理员可管理界面配置", 403)
  const parsed = UiConfigSchema.safeParse(await request.json())
  if (!parsed.success)
    return failure(
      "VALIDATION_ERROR",
      JSON.stringify(parsed.error.flatten().fieldErrors),
      400,
    )
  try {
    const [existing] = await db
      .select()
      .from(uiConfigs)
      .where(eq(uiConfigs.scope, parsed.data.scope))
      .limit(1)
    const [saved] = existing
      ? await db
          .update(uiConfigs)
          .set({ ...parsed.data, updatedAt: new Date() })
          .where(eq(uiConfigs.id, existing.id))
          .returning()
      : await db
          .insert(uiConfigs)
          .values(parsed.data)
          .returning()
    if (!saved) return failure("INTERNAL_ERROR", "保存界面配置失败", 500)
    await writeAuditLog({
      actor,
      action: "UPDATE",
      actionLabel: "更新界面配置",
      entityType: "ui_config",
      entityId: saved.id,
      detail: parsed.data,
    })
    return success(saved)
  } catch (error) {
    console.error("[API admin/ui-config PUT]", error)
    return failure("INTERNAL_ERROR", "服务器错误", 500)
  }
}