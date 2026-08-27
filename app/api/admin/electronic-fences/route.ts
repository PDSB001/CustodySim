import { and, desc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm"
import { NextRequest } from "next/server"
import { z } from "zod"

import { writeAuditLog } from "@/lib/audit"
import { ElectronicFenceSchema } from "@/lib/admin-schemas"
import { failure, success } from "@/lib/api-response"
import { getAdminUser } from "@/lib/admin-api"
import { db } from "@/lib/db"
import { electronicFences, persons } from "@/lib/db/schema"

const AdminElectronicFenceSchema = ElectronicFenceSchema.extend({
  userId: z.string().uuid().nullable().default(null),
})

function serializeFence(fence: typeof electronicFences.$inferSelect) {
  return {
    id: fence.id,
    name: fence.name,
    latitude: Number(fence.latitude),
    longitude: Number(fence.longitude),
    radiusMeters: fence.radiusMeters,
    boundaryPoints: fence.boundaryPoints ?? [],
    coordinateSystem: fence.coordinateSystem,
    enabled: fence.enabled,
    updatedAt: fence.updatedAt,
  }
}

export async function GET() {
  if (!(await getAdminUser()))
    return failure("FORBIDDEN", "仅管理员可管理电子围栏", 403)
  const [configs, people] = await Promise.all([
    db
      .select()
      .from(electronicFences)
      .where(eq(electronicFences.entryType, "CONFIG"))
      .orderBy(desc(electronicFences.updatedAt)),
    db
      .select({ id: persons.id, name: persons.name, userId: persons.userId })
      .from(persons)
      .where(
        and(
          eq(persons.personType, "SUPERVISED"),
          eq(persons.status, "active"),
          isNotNull(persons.userId),
        ),
      )
      .orderBy(persons.name),
  ])
  const defaultFence = configs.find((fence) => fence.userId === null)
  return success({
    defaultFence: defaultFence ? serializeFence(defaultFence) : null,
    persons: people.map((person) => ({
      ...person,
      userId: person.userId!,
      fence: configs.find((fence) => fence.userId === person.userId)
        ? serializeFence(
            configs.find((fence) => fence.userId === person.userId)!,
          )
        : null,
    })),
  })
}

export async function PUT(request: NextRequest) {
  const actor = await getAdminUser()
  if (!actor) return failure("FORBIDDEN", "仅管理员可管理电子围栏", 403)
  const parsed = AdminElectronicFenceSchema.safeParse(await request.json())
  if (!parsed.success)
    return failure("VALIDATION_ERROR", "电子围栏参数不合法", 400)
  try {
    if (parsed.data.userId) {
      const [person] = await db
        .select({ id: persons.id })
        .from(persons)
        .where(
          and(
            eq(persons.userId, parsed.data.userId),
            eq(persons.personType, "SUPERVISED"),
            eq(persons.status, "active"),
          ),
        )
        .limit(1)
      if (!person) return failure("NOT_FOUND", "指定人员不存在或已停用", 404)
    }

    const fence = await db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${`electronic-fence:${parsed.data.userId ?? "default"}`}))`,
      )
      const target = parsed.data.userId
        ? and(
            eq(electronicFences.entryType, "CONFIG"),
            eq(electronicFences.userId, parsed.data.userId),
          )
        : and(
            eq(electronicFences.entryType, "CONFIG"),
            isNull(electronicFences.userId),
          )
      const [existing] = await tx
        .select({ id: electronicFences.id })
        .from(electronicFences)
        .where(target)
        .orderBy(desc(electronicFences.updatedAt))
        .limit(1)
      const value = {
        name: parsed.data.name,
        latitude: String(parsed.data.latitude),
        longitude: String(parsed.data.longitude),
        radiusMeters: parsed.data.radiusMeters,
        boundaryPoints: parsed.data.boundaryPoints,
        entryType: "CONFIG" as const,
        userId: parsed.data.userId,
        enabled: parsed.data.enabled,
        updatedBy: actor.id,
        updatedAt: new Date(),
      }
      const [result] = existing
        ? await tx
            .update(electronicFences)
            .set(value)
            .where(eq(electronicFences.id, existing.id))
            .returning()
        : await tx.insert(electronicFences).values(value).returning()
      return { fence: result, isUpdate: Boolean(existing) }
    })
    if (!fence.fence) return failure("INTERNAL_ERROR", "保存电子围栏失败", 500)
    await writeAuditLog({
      actor,
      action: fence.isUpdate ? "UPDATE" : "CREATE",
      actionLabel: parsed.data.userId
        ? "更新人员电子围栏"
        : fence.isUpdate
          ? "更新默认电子围栏"
          : "创建默认电子围栏",
      entityType: "electronic_fence",
      entityId: fence.fence.id,
      detail: {
        name: fence.fence.name,
        enabled: fence.fence.enabled,
        userId: parsed.data.userId,
      },
    })
    return success(serializeFence(fence.fence))
  } catch (error) {
    console.error("[API electronic-fences PUT]", error)
    return failure("INTERNAL_ERROR", "保存电子围栏失败", 500)
  }
}

export async function DELETE(request: NextRequest) {
  const actor = await getAdminUser()
  if (!actor) return failure("FORBIDDEN", "仅管理员可管理电子围栏", 403)
  const userId = request.nextUrl.searchParams.get("userId")
  const isDefault = userId === "default"
  const parsedUserId = z.string().uuid().safeParse(userId)
  if (!isDefault && !parsedUserId.success)
    return failure("VALIDATION_ERROR", "请指定要删除专属围栏的人员", 400)
  const targetUserId = isDefault ? null : parsedUserId.data!

  try {
    const result = await db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${`electronic-fence:${isDefault ? "default" : targetUserId}`}))`,
      )
      const configTarget = isDefault
        ? and(eq(electronicFences.entryType, "CONFIG"), isNull(electronicFences.userId))
        : and(eq(electronicFences.entryType, "CONFIG"), eq(electronicFences.userId, targetUserId!))
      const configs = await tx
        .select({ id: electronicFences.id })
        .from(electronicFences)
        .where(configTarget)
      if (!configs.length) return { deleted: false }
      const ids = configs.map((config) => config.id)
      // 解除历史定位记录对配置的引用，避免删除覆盖配置时级联清除定位记录。
      await tx
        .update(electronicFences)
        .set({ fenceId: null })
        .where(inArray(electronicFences.fenceId, ids))
      await tx.delete(electronicFences).where(inArray(electronicFences.id, ids))
      return { deleted: true }
    })
    if (result.deleted)
      await writeAuditLog({
        actor,
        action: "DELETE",
        actionLabel: isDefault ? "删除默认电子围栏" : "删除人员专属电子围栏",
        entityType: "electronic_fence",
        detail: { userId: isDefault ? null : parsedUserId.data },
      })
    return success({ userId: targetUserId, ...result })
  } catch (error) {
    console.error("[API electronic-fences DELETE]", error)
    return failure("INTERNAL_ERROR", "删除人员专属围栏失败", 500)
  }
}
