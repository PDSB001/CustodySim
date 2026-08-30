import { asc } from "drizzle-orm"
import { NextRequest } from "next/server"

import { failure, success } from "@/lib/api-response"
import { getAdminUser } from "@/lib/admin-api"
import { SupervisionRelationSchema } from "@/lib/admin-schemas"
import { writeAuditLog } from "@/lib/audit"
import { db } from "@/lib/db"
import {
  supervisionRelationScopes,
  supervisionRelations,
} from "@/lib/db/schema"

async function listRelations() {
  const relations = await db
    .select()
    .from(supervisionRelations)
    .orderBy(asc(supervisionRelations.createdAt))
  const scopes = await db.select().from(supervisionRelationScopes)
  return relations.map((relation) => ({
    ...relation,
    supervisorScopes: scopes.filter(
      (scope) =>
        scope.relationId === relation.id && scope.side === "SUPERVISOR",
    ),
    supervisedScopes: scopes.filter(
      (scope) =>
        scope.relationId === relation.id && scope.side === "SUPERVISED",
    ),
  }))
}

export async function GET() {
  if (!(await getAdminUser()))
    return failure("FORBIDDEN", "仅管理员可查看监管关系", 403)
  try {
    return success(await listRelations())
  } catch (error) {
    console.error("[API relations GET]", error)
    return failure("INTERNAL_ERROR", "服务器错误", 500)
  }
}

export async function POST(request: NextRequest) {
  const actor = await getAdminUser()
  if (!actor) return failure("FORBIDDEN", "仅管理员可管理监管关系", 403)
  const parsed = SupervisionRelationSchema.safeParse(await request.json())
  if (!parsed.success)
    return failure(
      "VALIDATION_ERROR",
      JSON.stringify(parsed.error.flatten().fieldErrors),
      400,
    )
  try {
    const result = await db.transaction(async (tx) => {
      const [relation] = await tx
        .insert(supervisionRelations)
        .values({
          name: parsed.data.name,
          status: parsed.data.status,
          startDate: parsed.data.startDate
            ? new Date(parsed.data.startDate)
            : null,
          endDate: parsed.data.endDate ? new Date(parsed.data.endDate) : null,
        })
        .returning()
      if (!relation) throw new Error("创建监管关系失败")
      const insertedScopes = await tx
        .insert(supervisionRelationScopes)
        .values([
          ...parsed.data.supervisorScopes.map((scope) => ({
            ...scope,
            relationId: relation.id,
            side: "SUPERVISOR",
          })),
          ...parsed.data.supervisedScopes.map((scope) => ({
            ...scope,
            relationId: relation.id,
            side: "SUPERVISED",
          })),
        ])
        .returning()
      await writeAuditLog(
        {
          actor,
          action: "CREATE",
          actionLabel: "创建监管关系",
          entityType: "supervision_relation",
          entityId: relation.id,
          detail: { name: relation.name },
        },
        tx,
      )
      return {
        ...relation,
        supervisorScopes: insertedScopes.filter(
          (scope) => scope.side === "SUPERVISOR",
        ),
        supervisedScopes: insertedScopes.filter(
          (scope) => scope.side === "SUPERVISED",
        ),
      }
    })
    return success(result, { status: 201 })
  } catch (error) {
    console.error("[API relations POST]", error)
    return failure("INTERNAL_ERROR", "服务器错误", 500)
  }
}
