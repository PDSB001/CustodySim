import { eq } from "drizzle-orm"
import { NextRequest } from "next/server"
import { z } from "zod"

import { getAdminUser } from "@/lib/admin-api"
import { failure, success } from "@/lib/api-response"
import { writeAuditLog } from "@/lib/audit"
import { db } from "@/lib/db"
import { organizations, persons } from "@/lib/db/schema"

const ParamsSchema = z.object({ id: z.string().uuid() })
const RoomSchema = z.object({ organizationId: z.string().uuid() })
type RouteContext = { params: Promise<{ id: string }> }

export async function PATCH(request: NextRequest, context: RouteContext) {
  const actor = await getAdminUser()
  if (!actor) return failure("FORBIDDEN", "仅管理员可调整所在监室", 403)
  const [params, body] = await Promise.all([
    context.params.then((value) => ParamsSchema.safeParse(value)),
    request.json().then((value: unknown) => RoomSchema.safeParse(value)),
  ])
  if (!params.success || !body.success)
    return failure("VALIDATION_ERROR", "监室参数不合法", 400)
  const [room] = await db
    .select({
      id: organizations.id,
      name: organizations.name,
      category: organizations.category,
    })
    .from(organizations)
    .where(eq(organizations.id, body.data.organizationId))
    .limit(1)
  if (!room || room.category !== "ROOM")
    return failure("VALIDATION_ERROR", "请选择具体监室", 400)
  const [updated] = await db
    .update(persons)
    .set({ organizationId: room.id, updatedAt: new Date() })
    .where(eq(persons.id, params.data.id))
    .returning()
  if (!updated) return failure("NOT_FOUND", "人员不存在", 404)
  await writeAuditLog({
    actor,
    action: "UPDATE",
    actionLabel: "调整所在监室",
    entityType: "person",
    entityId: updated.id,
    detail: { organizationId: room.id, organizationName: room.name },
  })
  return success(updated)
}
