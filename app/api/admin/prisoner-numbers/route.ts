import { asc, eq } from "drizzle-orm"
import { NextRequest } from "next/server"

import { failure, success } from "@/lib/api-response"
import { getAdminUser } from "@/lib/admin-api"
import { PrisonerNumberSchema } from "@/lib/admin-schemas"
import { writeAuditLog } from "@/lib/audit"
import { buildCode, buildRandomCode } from "@/lib/numbering"
import { db } from "@/lib/db"
import { numberingRules, persons, prisonerNumberChanges } from "@/lib/db/schema"

const DOC_TYPE = "PRISONER"

export async function GET() {
  const actor = await getAdminUser()
  if (!actor) return failure("FORBIDDEN", "仅管理员可查看人员编号", 403)
  const data = await db
    .select({
      id: persons.id,
      name: persons.name,
      prisonerNumber: persons.prisonerNumber,
      customNumber: persons.customNumber,
      status: persons.status,
      createdAt: persons.createdAt,
    })
    .from(persons)
    .where(eq(persons.personType, "SUPERVISED"))
    .orderBy(asc(persons.createdAt))
  return success(data)
}

export async function POST(request: NextRequest) {
  const actor = await getAdminUser()
  if (!actor) return failure("FORBIDDEN", "仅管理员可管理人员编号", 403)
  const parsed = PrisonerNumberSchema.safeParse(await request.json())
  if (!parsed.success)
    return failure(
      "VALIDATION_ERROR",
      JSON.stringify(parsed.error.flatten().fieldErrors),
      400,
    )
  try {
    const result = await db.transaction(async (tx) => {
      const [person] = await tx
        .select()
        .from(persons)
        .where(eq(persons.id, parsed.data.personId))
        .limit(1)
      if (!person) return null
      let number = parsed.data.number
      if (!number) {
        const [existingRule] = await tx
          .select()
          .from(numberingRules)
          .where(eq(numberingRules.docType, DOC_TYPE))
          .limit(1)
        const rule =
          existingRule ??
          (
            await tx
              .insert(numberingRules)
              .values({
                docType: DOC_TYPE,
                prefix: "CS",
                dateFormat: "NONE",
                generationMode: "RANDOM",
                minLength: 4,
                randomLength: 6,
                currentSeq: 0,
              })
              .returning()
          )[0]
        if (!rule) throw new Error("编号规则初始化失败")
        if (rule.generationMode === "SEQUENTIAL") {
          const nextSequence = rule.currentSeq + 1
          number = buildCode({
            prefix: rule.prefix,
            dateFormat: rule.dateFormat,
            minLength: rule.minLength,
            sequence: nextSequence,
          })
          await tx
            .update(numberingRules)
            .set({ currentSeq: nextSequence, updatedAt: new Date() })
            .where(eq(numberingRules.id, rule.id))
        } else {
          for (let attempt = 0; attempt < 12; attempt += 1) {
            const candidate = buildRandomCode({
              prefix: rule.prefix,
              dateFormat: rule.dateFormat,
              randomLength: rule.randomLength,
            })
            const [occupied] = await tx
              .select({ id: persons.id })
              .from(persons)
              .where(eq(persons.prisonerNumber, candidate))
              .limit(1)
            if (!occupied) {
              number = candidate
              break
            }
          }
          if (!number) throw new Error("随机编号重试次数已耗尽")
        }
      }
      const [updated] = await tx
        .update(persons)
        .set({ prisonerNumber: number, updatedAt: new Date() })
        .where(eq(persons.id, person.id))
        .returning()
      if (!updated) throw new Error("人员编号更新失败")
      await tx.insert(prisonerNumberChanges).values({
        personId: person.id,
        oldNumber: person.prisonerNumber,
        newNumber: number,
        reason: parsed.data.reason ?? null,
        requestedBy: actor.id,
        reviewedBy: actor.id,
        reviewedAt: new Date(),
      })
      return updated
    })
    if (!result) return failure("NOT_FOUND", "人员不存在", 404)
    await writeAuditLog({
      actor,
      action: "ASSIGN_NUMBER",
      actionLabel: "分配人员编号",
      entityType: "person",
      entityId: result.id,
      detail: { number: result.prisonerNumber },
    })
    return success(result)
  } catch (error) {
    const code =
      typeof error === "object" && error && "code" in error ? error.code : null
    if (code === "23505") return failure("CONFLICT", "该编号已被占用", 409)
    console.error("[API admin/prisoner-numbers POST]", error)
    return failure("INTERNAL_ERROR", "服务器错误", 500)
  }
}
