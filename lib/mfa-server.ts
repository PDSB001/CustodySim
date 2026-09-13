import { and, eq, gt, isNull, lt } from "drizzle-orm"

import { db } from "@/lib/db"
import {
  mfaFactors,
  mfaRecoveryCodes,
  mfaTrustedDevices,
} from "@/lib/db/schema"
import {
  hashRecoveryCode,
  hashTrustedDeviceToken,
  parseTrustedDeviceCookie,
  decryptMfaSecret,
  matchTotpStep,
} from "@/lib/mfa"

type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0]

export async function consumeMfaCodeInTransaction(
  tx: DbTransaction,
  factor: typeof mfaFactors.$inferSelect,
  code: string,
) {
  const step = matchTotpStep(decryptMfaSecret(factor.secretEncrypted), code)
  if (step !== null) {
    const [used] = await tx
      .update(mfaFactors)
      .set({ lastUsedStep: step })
      .where(
        and(
          eq(mfaFactors.id, factor.id),
          eq(mfaFactors.enabled, true),
          eq(mfaFactors.secretEncrypted, factor.secretEncrypted),
          lt(mfaFactors.lastUsedStep, step),
        ),
      )
      .returning({ id: mfaFactors.id })
    return Boolean(used)
  }
  return consumeRecoveryCodeInTransaction(tx, factor.id, code)
}

export async function getValidTrustedDevice(
  userId: string,
  cookieValue: string | undefined,
) {
  const parsed = parseTrustedDeviceCookie(cookieValue)
  if (!parsed) return null
  const [device] = await db
    .select({ id: mfaTrustedDevices.id })
    .from(mfaTrustedDevices)
    .where(
      and(
        eq(mfaTrustedDevices.id, parsed.deviceId),
        eq(mfaTrustedDevices.userId, userId),
        eq(mfaTrustedDevices.tokenHash, hashTrustedDeviceToken(parsed.token)),
        isNull(mfaTrustedDevices.revokedAt),
        gt(mfaTrustedDevices.expiresAt, new Date()),
      ),
    )
    .limit(1)
  if (!device) return null
  await db
    .update(mfaTrustedDevices)
    .set({ lastUsedAt: new Date() })
    .where(eq(mfaTrustedDevices.id, device.id))
  return device
}

export async function consumeRecoveryCodeInTransaction(
  tx: DbTransaction,
  factorId: string,
  code: string,
) {
  const [recoveryCode] = await tx
    .select({ id: mfaRecoveryCodes.id })
    .from(mfaRecoveryCodes)
    .where(
      and(
        eq(mfaRecoveryCodes.factorId, factorId),
        eq(mfaRecoveryCodes.codeHash, hashRecoveryCode(code)),
        isNull(mfaRecoveryCodes.usedAt),
      ),
    )
    .limit(1)
  if (!recoveryCode) return false
  const [used] = await tx
    .update(mfaRecoveryCodes)
    .set({ usedAt: new Date() })
    .where(
      and(
        eq(mfaRecoveryCodes.id, recoveryCode.id),
        isNull(mfaRecoveryCodes.usedAt),
      ),
    )
    .returning({ id: mfaRecoveryCodes.id })
  return Boolean(used)
}

export async function consumeRecoveryCode(factorId: string, code: string) {
  return db.transaction((tx) =>
    consumeRecoveryCodeInTransaction(tx, factorId, code),
  )
}

export async function revokeTrustedDevices(userId: string) {
  await revokeTrustedDevicesInTransaction(db, userId)
}

export async function revokeTrustedDevicesInTransaction(
  executor: Pick<typeof db, "update">,
  userId: string,
) {
  await executor
    .update(mfaTrustedDevices)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(mfaTrustedDevices.userId, userId),
        isNull(mfaTrustedDevices.revokedAt),
      ),
    )
}
