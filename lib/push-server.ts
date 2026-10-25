import { createHash, randomUUID, timingSafeEqual } from "node:crypto"
import { and, eq, inArray, isNull, ne, sql } from "drizzle-orm"
import { SignJWT } from "jose"

import { db } from "@/lib/db"
import {
  chatConversationMembers,
  notices,
  pushDeliveries,
  pushDevices,
  users,
} from "@/lib/db/schema"

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]
export function installationHash(secret: string) {
  return createHash("sha256").update(secret).digest("hex")
}
export function ownsInstallation(hash: string, secret: string) {
  const expected = Buffer.from(hash, "hex")
  const actual = Buffer.from(installationHash(secret), "hex")
  return expected.length === actual.length && timingSafeEqual(expected, actual)
}

export async function registerPushDevice(
  userId: string,
  input: {
    installationId: string
    secret: string
    providerToken?: string | null
    enabled: boolean
  },
) {
  return db.transaction(async (tx) => {
    // Serialize rebinding and provider-token rotation across sessions/installations.
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext('push-device-registration'))`,
    )
    const [account] = await tx
      .select({ version: users.tokenVersion })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1)
    if (!account) throw new Error("账号不可用")
    const [existing] = await tx
      .select()
      .from(pushDevices)
      .where(eq(pushDevices.installationId, input.installationId))
      .limit(1)
      .for("update")
    if (existing && !ownsInstallation(existing.secretHash, input.secret))
      return null
    const token = input.providerToken ?? null
    if (token)
      await tx
        .update(pushDevices)
        .set({
          providerToken: null,
          enabled: false,
          bindingId: randomUUID(),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(pushDevices.providerToken, token),
            ne(pushDevices.installationId, input.installationId),
          ),
        )
    const changed =
      !existing ||
      existing.userId !== userId ||
      existing.tokenVersion !== account.version ||
      existing.providerToken !== token ||
      existing.enabled !== input.enabled
    const values = {
      userId,
      tokenVersion: account.version,
      providerToken: token,
      enabled: input.enabled,
      bindingId: changed ? randomUUID() : existing.bindingId,
      updatedAt: new Date(),
    }
    const [device] = existing
      ? await tx
          .update(pushDevices)
          .set(values)
          .where(eq(pushDevices.id, existing.id))
          .returning()
      : await tx
          .insert(pushDevices)
          .values({
            ...values,
            installationId: input.installationId,
            secretHash: installationHash(input.secret),
          })
          .returning()
    return { id: device!.id, bindingId: device!.bindingId }
  })
}

export async function deviceRealtimeToken(
  userId: string,
  deviceId: string,
  secret: string,
) {
  const [device] = await db
    .select({ device: pushDevices, account: users })
    .from(pushDevices)
    .innerJoin(users, eq(users.id, pushDevices.userId))
    .where(
      and(
        eq(pushDevices.id, deviceId),
        eq(pushDevices.userId, userId),
        eq(pushDevices.enabled, true),
      ),
    )
    .limit(1)
  if (
    !device ||
    !ownsInstallation(device.device.secretHash, secret) ||
    device.account.status !== "active" ||
    device.account.tokenVersion !== device.device.tokenVersion
  )
    return null
  const authSecret = process.env.AUTH_SECRET
  if (!authSecret) throw new Error("AUTH_SECRET missing")
  return new SignJWT({
    purpose: "app-notifications",
    deviceId,
    bindingId: device.device.bindingId,
    tokenVersion: device.account.tokenVersion,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(new TextEncoder().encode(authSecret))
}

export async function enqueueChatNotifications(
  tx: Tx,
  messageId: string,
  conversationId: string,
  senderId: string,
) {
  const members = await tx
    .select({ id: chatConversationMembers.userId })
    .from(chatConversationMembers)
    .where(
      and(
        eq(chatConversationMembers.conversationId, conversationId),
        isNull(chatConversationMembers.leftAt),
        ne(chatConversationMembers.userId, senderId),
      ),
    )
  if (!members.length) return
  const devices = await tx
    .select()
    .from(pushDevices)
    .where(
      and(
        inArray(
          pushDevices.userId,
          members.map((m) => m.id),
        ),
        eq(pushDevices.enabled, true),
      ),
    )
  if (!devices.length) return
  await tx
    .insert(pushDeliveries)
    .values(
      devices.map((device) => ({
        deviceId: device.id,
        userId: device.userId,
        bindingId: device.bindingId,
        eventKey: `CHAT:${messageId}`,
        kind: "CHAT",
        entityId: messageId,
        conversationId,
      })),
    )
    .onConflictDoNothing()
  await tx.execute(sql`select pg_notify('custodysim_push', 'ready')`)
}

export async function enqueueNoticeNotifications(tx: Tx, noticeId: string) {
  const [notice] = await tx
    .select()
    .from(notices)
    .where(eq(notices.id, noticeId))
    .limit(1)
  if (
    !notice?.published ||
    (notice.expiresAt && notice.expiresAt <= new Date())
  )
    return
  const devices = await tx
    .select({ device: pushDevices })
    .from(pushDevices)
    .innerJoin(users, eq(users.id, pushDevices.userId))
    .where(
      and(
        eq(pushDevices.enabled, true),
        eq(users.status, "active"),
        notice.targetRole === "ALL"
          ? undefined
          : eq(users.role, notice.targetRole as typeof users.$inferSelect.role),
      ),
    )
  if (!devices.length) return
  await tx
    .insert(pushDeliveries)
    .values(
      devices.map(({ device }) => ({
        deviceId: device.id,
        userId: device.userId,
        bindingId: device.bindingId,
        eventKey: `NOTICE:${noticeId}:${notice.updatedAt.toISOString()}`,
        kind: "NOTICE",
        entityId: noticeId,
      })),
    )
    .onConflictDoNothing()
  await tx.execute(sql`select pg_notify('custodysim_push', 'ready')`)
}
