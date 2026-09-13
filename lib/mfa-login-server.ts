import { and, eq } from "drizzle-orm"
import { db } from "@/lib/db"
import {
  mfaFactors,
  mfaLoginChallenges,
  mfaTrustedDevices,
  users,
} from "@/lib/db/schema"
import { consumeMfaCodeInTransaction } from "@/lib/mfa-server"
import { generateTrustedDeviceToken, hashTrustedDeviceToken } from "@/lib/mfa"
import type { MfaChallengePayload } from "@/lib/auth"
import { MFA_TRUSTED_DEVICE_TTL_SECONDS } from "@/lib/constants"

export async function consumeMfaLogin(
  challenge: MfaChallengePayload,
  code: string,
  trustDevice: boolean,
  ip: string | null,
) {
  return db.transaction(async (tx) => {
    const [user] = await tx
      .select()
      .from(users)
      .where(eq(users.id, challenge.userId))
      .for("update")
    if (
      !user ||
      user.status !== "active" ||
      user.tokenVersion !== challenge.tokenVersion ||
      !["ADMIN", "SUPERVISOR", "SUPERVISED"].includes(user.role)
    )
      return null
    const [factor] = await tx
      .select()
      .from(mfaFactors)
      .where(and(eq(mfaFactors.userId, user.id), eq(mfaFactors.enabled, true)))
      .for("update")
    const [pending] = await tx
      .select()
      .from(mfaLoginChallenges)
      .where(
        and(
          eq(mfaLoginChallenges.id, challenge.challengeId),
          eq(mfaLoginChallenges.userId, user.id),
        ),
      )
      .for("update")
    if (
      !factor ||
      !pending ||
      pending.tokenVersion !== user.tokenVersion ||
      pending.consumedAt ||
      pending.expiresAt <= new Date() ||
      pending.attempts >= 5
    )
      return null
    await tx
      .update(mfaLoginChallenges)
      .set({ attempts: pending.attempts + 1 })
      .where(eq(mfaLoginChallenges.id, pending.id))
    if (!(await consumeMfaCodeInTransaction(tx, factor, code))) return null
    await tx
      .update(mfaLoginChallenges)
      .set({ consumedAt: new Date() })
      .where(eq(mfaLoginChallenges.id, pending.id))
    const deviceToken = trustDevice ? generateTrustedDeviceToken() : null
    let deviceId: string | null = null
    if (deviceToken) {
      const [device] = await tx
        .insert(mfaTrustedDevices)
        .values({
          userId: user.id,
          tokenHash: hashTrustedDeviceToken(deviceToken),
          label: "受信任设备",
          ip,
          expiresAt: new Date(
            Date.now() + MFA_TRUSTED_DEVICE_TTL_SECONDS * 1000,
          ),
        })
        .returning({ id: mfaTrustedDevices.id })
      deviceId = device.id
    }
    return { user, deviceToken, deviceId }
  })
}
