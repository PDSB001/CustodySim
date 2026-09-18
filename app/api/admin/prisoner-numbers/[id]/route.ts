import { eq } from "drizzle-orm"
import { NextRequest } from "next/server"
import { z } from "zod"

import { failure, success } from "@/lib/api-response"
import { getAdminUser } from "@/lib/admin-api"
import { writeAuditLog } from "@/lib/audit"
import { db } from "@/lib/db"
import { persons, prisonerNumberChanges } from "@/lib/db/schema"

const UpdateSchema = z.object({
  number: z.string().trim().min(1).max(50),
  reason: z.string().trim().max(500).optional(),
})
type RouteContext = { params: Promise<{ id: string }> }

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const actor = await getAdminUser()
  if (!actor) return failure("FORBIDDEN", "仅管理员可管理人员编号", 403)
  const { id } = await params
  if (!z.string().uuid().safeParse(id).success)
    return failure("VALIDATION_ERROR", "人员 ID 不合法", 400)
  const parsed = UpdateSchema.safeParse(await request.json())
  if (!parsed.success)
    return failure(
      "VALIDATION_ERROR",
      JSON.stringify(parsed.error.flatten().fieldErrors),
      400,
    )
  try {
    const updated = await db.transaction(async (tx) => {
      const [person] = await tx
        .select()
        .from(persons)
        .where(eq(persons.id, id))
        .limit(1)
      if (!person) return null
      const [row] = await tx
        .update(persons)
        .set({ prisonerNumber: parsed.data.number, updatedAt: new Date() })
        .where(eq(persons.id, id))
        .returning()
      if (!row) throw new Error("编号更新失败")
      await tx.insert(prisonerNumberChanges).values({
        personId: id,
        oldNumber: person.prisonerNumber,
        newNumber: parsed.data.number,
        reason: parsed.data.reason ?? null,
        requestedBy: actor.id,
        reviewedBy: actor.id,
        reviewedAt: new Date(),
      })
      await writeAuditLog(
        {
          actor,
          action: "UPDATE_NUMBER",
          actionLabel: "修改人员编号",
          entityType: "person",
          entityId: id,
          detail: { number: parsed.data.number },
        },
        tx,
      )
      return row
    })
    if (!updated) return failure("NOT_FOUND", "人员不存在", 404)
    return success(updated)
  } catch (error) {
    const code =
      typeof error === "object" && error && "code" in error ? error.code : null
    if (code === "23505") return failure("CONFLICT", "该编号已被占用", 409)
    console.error("[API admin/prisoner-numbers PATCH]", error)
    return failure("INTERNAL_ERROR", "服务器错误", 500)
  }
}
