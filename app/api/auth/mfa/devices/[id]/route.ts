import { and, eq, isNull } from "drizzle-orm"

import { failure, success } from "@/lib/api-response"
import { writeAuditLog } from "@/lib/audit"
import { db } from "@/lib/db"
import { mfaTrustedDevices } from "@/lib/db/schema"
import { getSessionUser } from "@/lib/session"

type RouteContext = { params: Promise<{ id: string }> }

export const runtime = "nodejs"

export async function DELETE(_: Request, { params }: RouteContext) {
  try {
    const user = await getSessionUser()
    if (!user) return failure("UNAUTHORIZED", "未登录", 401)
    const { id } = await params
    const [device] = await db.transaction(async (tx) => {
      const revoked = await tx
        .update(mfaTrustedDevices)
        .set({ revokedAt: new Date() })
        .where(
          and(
            eq(mfaTrustedDevices.id, id),
            eq(mfaTrustedDevices.userId, user.id),
            isNull(mfaTrustedDevices.revokedAt),
          ),
        )
        .returning({ id: mfaTrustedDevices.id })
      const revokedDevice = revoked[0]
      if (!revokedDevice) return []
      await writeAuditLog(
        {
          actor: user,
          action: "MFA_TRUSTED_DEVICE_REVOKE",
          actionLabel: "撤销受信任设备",
          entityType: "mfa_trusted_device",
          entityId: revokedDevice.id,
        },
        tx,
      )
      return [revokedDevice]
    })
    if (!device) return failure("NOT_FOUND", "受信任设备不存在", 404)
    return success({ revoked: true })
  } catch (error) {
    console.error("[API auth/mfa/devices DELETE]", error)
    return failure("INTERNAL_ERROR", "撤销设备失败", 500)
  }
}
