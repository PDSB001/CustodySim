import { and, eq } from "drizzle-orm"
import { z } from "zod"
import { failure, success } from "@/lib/api-response"
import { getSessionUser } from "@/lib/session"
import { registerPushDevice, ownsInstallation } from "@/lib/push-server"
import { db } from "@/lib/db"
import { pushDevices } from "@/lib/db/schema"

const Credentials = z.object({
  installationId: z.string().uuid(),
  secret: z.string().regex(/^[a-f0-9]{64}$/),
})
const Registration = Credentials.extend({
  providerToken: z
    .string()
    .regex(/^[A-Za-z0-9_+/=-]{32,256}$/)
    .nullable()
    .optional(),
  enabled: z.boolean(),
})

export async function POST(request: Request) {
  const actor = await getSessionUser()
  if (!actor) return failure("UNAUTHORIZED", "请先登录", 401)
  const parsed = Registration.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return failure("VALIDATION_ERROR", "设备参数不合法", 400)
  try {
    const result = await registerPushDevice(actor.id, parsed.data)
    return result
      ? success(result)
      : failure("FORBIDDEN", "设备凭证不匹配", 403)
  } catch {
    return failure("INTERNAL_ERROR", "注册通知设备失败", 500)
  }
}

export async function DELETE(request: Request) {
  const actor = await getSessionUser()
  if (!actor) return failure("UNAUTHORIZED", "请先登录", 401)
  const parsed = Credentials.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return failure("VALIDATION_ERROR", "设备参数不合法", 400)
  const [device] = await db
    .select()
    .from(pushDevices)
    .where(
      and(
        eq(pushDevices.installationId, parsed.data.installationId),
        eq(pushDevices.userId, actor.id),
      ),
    )
    .limit(1)
  if (device && !ownsInstallation(device.secretHash, parsed.data.secret))
    return failure("FORBIDDEN", "设备凭证不匹配", 403)
  if (device)
    await db
      .delete(pushDevices)
      .where(
        and(
          eq(pushDevices.id, device.id),
          eq(pushDevices.bindingId, device.bindingId),
          eq(pushDevices.secretHash, device.secretHash),
          eq(pushDevices.userId, actor.id),
        ),
      )
  return success({ removed: true })
}
