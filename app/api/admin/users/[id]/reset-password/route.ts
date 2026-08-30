import { eq } from "drizzle-orm"
import { NextRequest } from "next/server"

import { failure, success } from "@/lib/api-response"
import { getAdminUser } from "@/lib/admin-api"
import { writeAuditLog } from "@/lib/audit"
import { hashPassword } from "@/lib/auth"
import { db } from "@/lib/db"
import { users } from "@/lib/db/schema"
import { computePasswordMeta } from "@/lib/password-rule"
import { revokeTrustedDevicesInTransaction } from "@/lib/mfa-server"

type RouteContext = { params: Promise<{ id: string }> }

export async function POST(request: NextRequest, { params }: RouteContext) {
  const actor = await getAdminUser()
  if (!actor) return failure("FORBIDDEN", "仅管理员可重置密码", 403)
  const { id } = await params
  void request
  const temporaryPassword = `Tmp-${crypto.randomUUID().replaceAll("-", "").slice(0, 16)}9`
  try {
    const [existing] = await db
      .select({ tokenVersion: users.tokenVersion, username: users.username })
      .from(users)
      .where(eq(users.id, id))
      .limit(1)
    if (!existing) return failure("NOT_FOUND", "用户不存在", 404)
    const passwordHash = await hashPassword(temporaryPassword)
    await db.transaction(async (tx) => {
      await tx
        .update(users)
        .set({
          passwordHash,
          passwordMeta: JSON.stringify(
            computePasswordMeta(temporaryPassword),
          ),
          mustChangePassword: true,
          tokenVersion: existing.tokenVersion + 1,
          updatedAt: new Date(),
        })
        .where(eq(users.id, id))
      await revokeTrustedDevicesInTransaction(tx, id)
      await writeAuditLog(
        {
          actor,
          action: "RESET_PASSWORD",
          actionLabel: "重置用户密码",
          entityType: "user",
          entityId: id,
          detail: { username: existing.username },
        },
        tx,
      )
    })
    return success({ id, temporaryPassword })
  } catch (error) {
    console.error("[API admin/users reset-password POST]", error)
    return failure("INTERNAL_ERROR", "服务器错误", 500)
  }
}
