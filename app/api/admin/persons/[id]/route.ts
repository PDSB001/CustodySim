import { eq } from "drizzle-orm"
import { NextRequest } from "next/server"

import { failure, success } from "@/lib/api-response"
import { getAdminUser } from "@/lib/admin-api"
import { PersonSchema } from "@/lib/admin-schemas"
import { writeAuditLog } from "@/lib/audit"
import { db } from "@/lib/db"
import { persons } from "@/lib/db/schema"
import { organizations } from "@/lib/db/schema"
import { validatePersonOrganizationAssignment } from "@/lib/organization-assignment"
import type { OrganizationCategory } from "@/lib/constants"

type RouteContext = { params: Promise<{ id: string }> }

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const actor = await getAdminUser()
  if (!actor) return failure("FORBIDDEN", "仅管理员可管理人员", 403)
  const { id } = await params
  const parsed = PersonSchema.safeParse(await request.json())
  if (!parsed.success)
    return failure(
      "VALIDATION_ERROR",
      JSON.stringify(parsed.error.flatten().fieldErrors),
      400,
    )
  try {
    const [current] = await db
      .select({ custodyStatus: persons.custodyStatus })
      .from(persons)
      .where(eq(persons.id, id))
      .limit(1)
    if (!current) return failure("NOT_FOUND", "人员不存在", 404)
    if (
      current.custodyStatus === "ISOLATION" ||
      parsed.data.custodyStatus === "ISOLATION"
    )
      return failure("CONFLICT", "禁闭状态由积分系统统一控制", 409)
    const [organization] = parsed.data.organizationId
      ? await db
          .select({ category: organizations.category })
          .from(organizations)
          .where(eq(organizations.id, parsed.data.organizationId))
          .limit(1)
      : [undefined]
    if (parsed.data.personType === "SUPERVISED") {
      const organizationError = validatePersonOrganizationAssignment(
        (organization?.category ?? null) as OrganizationCategory | null,
      )
      if (organizationError)
        return failure("VALIDATION_ERROR", organizationError, 400)
    }
    const [updated] = await db
      .update(persons)
      .set({
        ...parsed.data,
        gender: parsed.data.gender ?? null,
        age: parsed.data.age ?? null,
        prisonerNumber: parsed.data.prisonerNumber ?? null,
        customNumber: parsed.data.customNumber ?? null,
        treatmentLevel: parsed.data.treatmentLevel ?? null,
        nativePlace: parsed.data.nativePlace ?? null,
        level: parsed.data.level ?? null,
        evaluation: parsed.data.evaluation ?? null,
        chargeName: parsed.data.chargeName ?? null,
        sentenceStartDate: parsed.data.sentenceStartDate ?? null,
        sentenceEndDate: parsed.data.sentenceEndDate ?? null,
        custodyLevel: parsed.data.custodyLevel,
        custodyStatus: parsed.data.custodyStatus,
        remark: parsed.data.remark ?? null,
        organizationId: parsed.data.organizationId ?? null,
        userId: parsed.data.userId ?? null,
        updatedAt: new Date(),
      })
      .where(eq(persons.id, id))
      .returning()
    if (!updated) return failure("NOT_FOUND", "人员不存在", 404)
    await writeAuditLog({
      actor,
      action: "UPDATE",
      actionLabel: "编辑人员",
      entityType: "person",
      entityId: id,
      detail: { name: updated.name },
    })
    return success(updated)
  } catch (error) {
    console.error("[API admin/persons PATCH]", error)
    return failure("INTERNAL_ERROR", "服务器错误", 500)
  }
}

export async function DELETE(_request: NextRequest, { params }: RouteContext) {
  const actor = await getAdminUser()
  if (!actor) return failure("FORBIDDEN", "仅管理员可管理人员", 403)
  const { id } = await params
  try {
    const [deleted] = await db
      .delete(persons)
      .where(eq(persons.id, id))
      .returning()
    if (!deleted) return failure("NOT_FOUND", "人员不存在", 404)
    await writeAuditLog({
      actor,
      action: "DELETE",
      actionLabel: "删除人员",
      entityType: "person",
      entityId: id,
      detail: { name: deleted.name },
    })
    return success({ id })
  } catch (error) {
    console.error("[API admin/persons DELETE]", error)
    return failure("INTERNAL_ERROR", "服务器错误", 500)
  }
}
