import { eq } from "drizzle-orm"
import { NextRequest } from "next/server"
import { z } from "zod"

import { writeAuditLog } from "@/lib/audit"
import { getAdminUser } from "@/lib/admin-api"
import { SupervisionRelationSchema } from "@/lib/admin-schemas"
import { failure, success } from "@/lib/api-response"
import { db } from "@/lib/db"
import {
  supervisionRelationScopes,
  supervisionRelations,
} from "@/lib/db/schema"

const Params = z.object({ id: z.string().uuid() })

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const actor = await getAdminUser()
  if (!actor) return failure("FORBIDDEN", "仅管理员可管理监管关系", 403)
  const params = Params.safeParse(await context.params)
  const body = SupervisionRelationSchema.safeParse(await request.json())
  if (!params.success || !body.success)
    return failure("VALIDATION_ERROR", "参数不合法", 400)
  try {
    const [updated] = await db
      .update(supervisionRelations)
      .set({
        name: body.data.name,
        status: body.data.status,
        startDate: body.data.startDate ? new Date(body.data.startDate) : null,
        endDate: body.data.endDate ? new Date(body.data.endDate) : null,
        updatedAt: new Date(),
      })
      .where(eq(supervisionRelations.id, params.data.id))
      .returning()
    if (!updated) return failure("NOT_FOUND", "监管关系不存在", 404)
    await db.transaction(async (tx) => {
      await tx
        .delete(supervisionRelationScopes)
        .where(eq(supervisionRelationScopes.relationId, updated.id))
      await tx.insert(supervisionRelationScopes).values([
        ...body.data.supervisorScopes.map((scope) => ({
          ...scope,
          relationId: updated.id,
          side: "SUPERVISOR" as const,
        })),
        ...body.data.supervisedScopes.map((scope) => ({
          ...scope,
          relationId: updated.id,
          side: "SUPERVISED" as const,
        })),
      ])
    })
    await writeAuditLog({
      actor,
      action: "UPDATE",
      actionLabel: "编辑监管关系",
      entityType: "supervision_relation",
      entityId: updated.id,
      detail: { name: updated.name },
    })
    return success(updated)
  } catch (error) {
    console.error("[API relations PATCH]", error)
    return failure("INTERNAL_ERROR", "服务器错误", 500)
  }
}

export async function DELETE(
  _: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const actor = await getAdminUser()
  if (!actor) return failure("FORBIDDEN", "仅管理员可管理监管关系", 403)
  const params = Params.safeParse(await context.params)
  if (!params.success) return failure("VALIDATION_ERROR", "参数不合法", 400)
  try {
    const [deleted] = await db
      .delete(supervisionRelations)
      .where(eq(supervisionRelations.id, params.data.id))
      .returning({ id: supervisionRelations.id, name: supervisionRelations.name })
    if (!deleted) return failure("NOT_FOUND", "监管关系不存在", 404)
    await writeAuditLog({
      actor,
      action: "DELETE",
      actionLabel: "删除监管关系",
      entityType: "supervision_relation",
      entityId: deleted.id,
      detail: { name: deleted.name },
    })
    return success({ id: deleted.id })
  } catch (error) {
    console.error("[API relations DELETE]", error)
    return failure("INTERNAL_ERROR", "服务器错误", 500)
  }
}