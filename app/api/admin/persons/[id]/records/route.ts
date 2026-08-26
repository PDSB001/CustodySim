import { asc, desc, eq } from "drizzle-orm"
import { z } from "zod"

import { getAdminUser } from "@/lib/admin-api"
import { failure, success } from "@/lib/api-response"
import { db } from "@/lib/db"
import {
  archiveBoxes,
  persons,
  profileForms,
  profileRecordReviews,
  profileRecords,
  users,
} from "@/lib/db/schema"
import { decryptHandwrittenSignature } from "@/lib/signature-server"

const ParamsSchema = z.object({ id: z.string().uuid() })
type RouteContext = { params: Promise<{ id: string }> }

export async function GET(_: Request, context: RouteContext) {
  if (!(await getAdminUser()))
    return failure("FORBIDDEN", "仅管理员可查看人员档案", 403)
  const params = ParamsSchema.safeParse(await context.params)
  if (!params.success) return failure("VALIDATION_ERROR", "参数不合法", 400)
  try {
    const [person] = await db
      .select({ userId: persons.userId })
      .from(persons)
      .where(eq(persons.id, params.data.id))
      .limit(1)
    if (!person) return failure("NOT_FOUND", "人员不存在", 404)
    if (!person.userId) return success([])
    const [rows, reviews] = await Promise.all([
      db
        .select({
          id: profileRecords.id,
          formName: profileForms.name,
          status: profileRecords.status,
          code: profileRecords.code,
          data: profileRecords.data,
          photoData: profileRecords.photoData,
          formSnapshot: profileRecords.formSnapshot,
          signatureMode: profileRecords.signatureMode,
          generatedSignatureData: profileRecords.generatedSignatureData,
          handwrittenSignatureEncrypted:
            profileRecords.handwrittenSignatureEncrypted,
          officialSealData: profileRecords.officialSealData,
          submittedAt: profileRecords.submittedAt,
          lockedAt: profileRecords.lockedAt,
          boxName: archiveBoxes.name,
          userName: users.name,
        })
        .from(profileRecords)
        .innerJoin(profileForms, eq(profileForms.id, profileRecords.formId))
        .innerJoin(users, eq(users.id, profileRecords.userId))
        .leftJoin(archiveBoxes, eq(archiveBoxes.id, profileRecords.boxId))
        .where(eq(profileRecords.userId, person.userId))
        .orderBy(desc(profileRecords.updatedAt)),
      db
        .select()
        .from(profileRecordReviews)
        .orderBy(asc(profileRecordReviews.step)),
    ])
    return success(
      rows.map(
        ({
          generatedSignatureData,
          handwrittenSignatureEncrypted,
          ...row
        }) => ({
          ...row,
          signatureData:
            row.signatureMode === "HANDWRITTEN" && handwrittenSignatureEncrypted
              ? decryptHandwrittenSignature(handwrittenSignatureEncrypted)
              : generatedSignatureData,
          reviews: reviews.filter((review) => review.recordId === row.id),
        }),
      ),
    )
  } catch (error) {
    console.error("[API admin/persons/records GET]", error)
    return failure("INTERNAL_ERROR", "服务器错误", 500)
  }
}
