import { asc } from "drizzle-orm"
import { NextRequest } from "next/server"

import { getAdminUser } from "@/lib/admin-api"
import { OfficialSealSchema } from "@/lib/admin-schemas"
import { failure, success } from "@/lib/api-response"
import { writeAuditLog } from "@/lib/audit"
import { db } from "@/lib/db"
import { officialSeals } from "@/lib/db/schema"
import {
  defaultOfficialSealText,
  OFFICIAL_SEAL_KINDS,
} from "@/lib/official-seal"

export async function GET() {
  if (!(await getAdminUser())) return failure("FORBIDDEN", "仅管理员可管理印章", 403)
  try {
    const stored = await db.select().from(officialSeals).orderBy(asc(officialSeals.kind))
    return success(
      OFFICIAL_SEAL_KINDS.map((kind) => {
        const seal = stored.find((item) => item.kind === kind)
        return seal ?? {
          id: null,
          kind,
          organizationName: "第一监狱",
          sealText: defaultOfficialSealText(kind),
          active: true,
          updatedAt: null,
        }
      }),
    )
  } catch (error) {
    console.error("[API admin/official-seals GET]", error)
    return failure("INTERNAL_ERROR", "服务器错误", 500)
  }
}

export async function PUT(request: NextRequest) {
  const actor = await getAdminUser()
  if (!actor) return failure("FORBIDDEN", "仅管理员可管理印章", 403)
  const parsed = OfficialSealSchema.safeParse(await request.json())
  if (!parsed.success) return failure("VALIDATION_ERROR", "印章参数不合法", 400)
  try {
    const [saved] = await db
      .insert(officialSeals)
      .values({ ...parsed.data, updatedBy: actor.id })
      .onConflictDoUpdate({
        target: officialSeals.kind,
        set: { ...parsed.data, updatedBy: actor.id, updatedAt: new Date() },
      })
      .returning()
    if (!saved) return failure("INTERNAL_ERROR", "保存印章失败", 500)
    await writeAuditLog({
      actor,
      action: "UPDATE",
      actionLabel: "更新业务印章",
      entityType: "official_seal",
      entityId: saved.id,
      detail: { kind: saved.kind, sealText: saved.sealText },
    })
    return success(saved)
  } catch (error) {
    console.error("[API admin/official-seals PUT]", error)
    return failure("INTERNAL_ERROR", "服务器错误", 500)
  }
}
