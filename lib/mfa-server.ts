import { and, eq, gt, isNull } from "drizzle-orm"

import { db } from "@/lib/db"
import { mfaRecoveryCodes, mfaTrustedDevices } from "@/lib/db/schema"
import {
  hashRecoveryCode,
  hashTrustedDeviceToken,
  parseTrustedDeviceCookie,
} from "@/lib/mfa"

type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0]

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
