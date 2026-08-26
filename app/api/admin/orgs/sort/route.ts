import { eq } from "drizzle-orm"
import { NextRequest } from "next/server"
import { z } from "zod"

import { failure, success } from "@/lib/api-response"
import { getAdminUser } from "@/lib/admin-api"
import { writeAuditLog } from "@/lib/audit"
import { db } from "@/lib/db"
import { organizations } from "@/lib/db/schema"

const SortSchema = z.object({
  items: z
    .array(z.object({ id: z.string().uuid(), sort: z.number().int().min(0) }))
    .min(1),
})

export async function POST(request: NextRequest) {
  const actor = await getAdminUser()
  if (!actor) return failure("FORBIDDEN", "仅管理员可排序组织", 403)
  const parsed = SortSchema.safeParse(await request.json())
  if (!parsed.success) return failure("VALIDATION_ERROR", "排序参数无效", 400)
  try {
    await db.transaction(async (tx) => {
      await Promise.all(
        parsed.data.items.map((item) =>
          tx
            .update(organizations)
            .set({ sort: item.sort, updatedAt: new Date() })
            .where(eq(organizations.id, item.id)),
        ),
      )
    })
    await writeAuditLog({
      actor,
      action: "SORT",
      actionLabel: "调整组织排序",
      entityType: "organization",
      detail: { count: parsed.data.items.length },
    })
    return success({ count: parsed.data.items.length })
  } catch (error) {
    console.error("[API admin/orgs/sort POST]", error)
    return failure("INTERNAL_ERROR", "服务器错误", 500)
  }
}
