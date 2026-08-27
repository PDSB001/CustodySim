import { and, desc, eq } from "drizzle-orm"
import { NextRequest } from "next/server"

import { writeAuditLog } from "@/lib/audit"
import { ElectronicFenceSchema } from "@/lib/admin-schemas"
import { failure, success } from "@/lib/api-response"
import { getAdminUser } from "@/lib/admin-api"
import { db } from "@/lib/db"
import { electronicFences } from "@/lib/db/schema"

function serializeFence(fence: typeof electronicFences.$inferSelect) {
  return {
    id: fence.id,
    name: fence.name,
    latitude: Number(fence.latitude),
    longitude: Number(fence.longitude),
    radiusMeters: fence.radiusMeters,
    coordinateSystem: fence.coordinateSystem,
    enabled: fence.enabled,
    updatedAt: fence.updatedAt,
  }
}

export async function GET() {
  if (!(await getAdminUser()))
    return failure("FORBIDDEN", "仅管理员可管理电子围栏", 403)
  const [fence] = await db
    .select()
    .from(electronicFences)
    .where(eq(electronicFences.entryType, "CONFIG"))
    .orderBy(desc(electronicFences.updatedAt))
    .limit(1)
  return success(fence ? serializeFence(fence) : null)
}

export async function PUT(request: NextRequest) {
  const actor = await getAdminUser()
  if (!actor) return failure("FORBIDDEN", "仅管理员可管理电子围栏", 403)
  const parsed = ElectronicFenceSchema.safeParse(await request.json())
  if (!parsed.success)
    return failure("VALIDATION_ERROR", "电子围栏参数不合法", 400)
  try {
    const [existing] = await db
      .select({ id: electronicFences.id })
      .from(electronicFences)
      .where(eq(electronicFences.entryType, "CONFIG"))
      .orderBy(desc(electronicFences.updatedAt))
      .limit(1)
    const value = {
      name: parsed.data.name,
      latitude: String(parsed.data.latitude),
      longitude: String(parsed.data.longitude),
      radiusMeters: parsed.data.radiusMeters,
      entryType: "CONFIG" as const,
      enabled: parsed.data.enabled,
      updatedBy: actor.id,
      updatedAt: new Date(),
    }
    const [fence] = existing
      ? await db
          .update(electronicFences)
          .set(value)
          .where(
            and(
              eq(electronicFences.id, existing.id),
              eq(electronicFences.entryType, "CONFIG"),
            ),
          )
          .returning()
      : await db
          .insert(electronicFences)
          .values(value)
          .returning()
    if (!fence) return failure("INTERNAL_ERROR", "保存电子围栏失败", 500)
    await writeAuditLog({
      actor,
      action: existing ? "UPDATE" : "CREATE",
      actionLabel: existing ? "更新电子围栏" : "创建电子围栏",
      entityType: "electronic_fence",
      entityId: fence.id,
      detail: { name: fence.name, enabled: fence.enabled },
    })
    return success(serializeFence(fence))
  } catch (error) {
    console.error("[API electronic-fences PUT]", error)
    return failure("INTERNAL_ERROR", "保存电子围栏失败", 500)
  }
}
