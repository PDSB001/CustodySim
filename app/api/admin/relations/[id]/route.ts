import { eq } from "drizzle-orm"
import { NextRequest } from "next/server"
import { z } from "zod"
import { failure, success } from "@/lib/api-response"
import { getAdminUser } from "@/lib/admin-api"
import { SupervisionRelationSchema } from "@/lib/admin-schemas"
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
  if (!(await getAdminUser()))
    return failure("FORBIDDEN", "仅管理员可管理监管关系", 403)
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
    await db
      .delete(supervisionRelationScopes)
      .where(eq(supervisionRelationScopes.relationId, updated.id))
    await db.insert(supervisionRelationScopes).values([
      ...body.data.supervisorScopes.map((scope) => ({
        ...scope,
        relationId: updated.id,
        side: "SUPERVISOR",
      })),
      ...body.data.supervisedScopes.map((scope) => ({
        ...scope,
        relationId: updated.id,
        side: "SUPERVISED",
      })),
    ])
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
  if (!(await getAdminUser()))
    return failure("FORBIDDEN", "仅管理员可管理监管关系", 403)
  const params = Params.safeParse(await context.params)
  if (!params.success) return failure("VALIDATION_ERROR", "参数不合法", 400)
  const [deleted] = await db
    .delete(supervisionRelations)
    .where(eq(supervisionRelations.id, params.data.id))
    .returning()
  return deleted
    ? success({ id: deleted.id })
    : failure("NOT_FOUND", "监管关系不存在", 404)
}
