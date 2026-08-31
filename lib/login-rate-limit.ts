import { createHash } from "node:crypto"

import { eq, sql } from "drizzle-orm"

import { db } from "@/lib/db"
import { loginRateLimits } from "@/lib/db/schema"

export const LOGIN_RATE_LIMIT_MAX_FAILURES = 5
export const LOGIN_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000
export const LOGIN_RATE_LIMIT_BLOCK_MS = 15 * 60 * 1000

function buildRateLimitKey(
  scope: "account" | "network",
  value: string,
  namespace = "login",
) {
  return createHash("sha256")
    .update(`custodysim:rate-limit:v1:${namespace}:${scope}:${value}`)
    .digest("hex")
}

export function getLoginRateLimitKeys(
  username: string,
  ip?: string | null,
  namespace = "login",
) {
  const keys = [
    buildRateLimitKey("account", username.trim().toLowerCase(), namespace),
  ]
  if (ip?.trim()) keys.push(buildRateLimitKey("network", ip.trim(), namespace))
  return keys
}

async function lockRateLimitKey(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  key: string,
) {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtext(${`login-rate-limit:${key}`}))`,
  )
}

export async function getLoginRetryAfterSeconds(
  username: string,
  ip?: string | null,
  now = new Date(),
  namespace = "login",
) {
  return db.transaction(async (tx) => {
    let retryAfterSeconds = 0
    for (const key of getLoginRateLimitKeys(username, ip, namespace)) {
      await lockRateLimitKey(tx, key)
      const [entry] = await tx
        .select({ blockedUntil: loginRateLimits.blockedUntil })
        .from(loginRateLimits)
        .where(eq(loginRateLimits.key, key))
        .limit(1)
      if (entry?.blockedUntil && entry.blockedUntil > now)
        retryAfterSeconds = Math.max(
          retryAfterSeconds,
          Math.ceil((entry.blockedUntil.getTime() - now.getTime()) / 1000),
        )
    }
    return retryAfterSeconds
  })
}

export async function recordLoginFailure(
  username: string,
  ip?: string | null,
  now = new Date(),
  namespace = "login",
) {
  await db.transaction(async (tx) => {
    for (const key of getLoginRateLimitKeys(username, ip, namespace)) {
      await lockRateLimitKey(tx, key)
      const [entry] = await tx
        .select()
        .from(loginRateLimits)
        .where(eq(loginRateLimits.key, key))
        .limit(1)
      const windowExpired =
        !entry ||
        now.getTime() - entry.windowStartedAt.getTime() >=
          LOGIN_RATE_LIMIT_WINDOW_MS
      const attemptCount = windowExpired ? 1 : entry.attemptCount + 1
      const blockedUntil =
        attemptCount >= LOGIN_RATE_LIMIT_MAX_FAILURES
          ? new Date(now.getTime() + LOGIN_RATE_LIMIT_BLOCK_MS)
          : null
      if (entry) {
        await tx
          .update(loginRateLimits)
          .set({
            attemptCount,
            windowStartedAt: windowExpired ? now : entry.windowStartedAt,
            blockedUntil,
            updatedAt: now,
          })
          .where(eq(loginRateLimits.key, key))
      } else {
        await tx.insert(loginRateLimits).values({
          key,
          attemptCount,
          windowStartedAt: now,
          blockedUntil,
          updatedAt: now,
        })
      }
    }
  })
}

export async function clearLoginFailures(
  username: string,
  ip?: string | null,
  namespace = "login",
) {
  await db.transaction(async (tx) => {
    for (const key of getLoginRateLimitKeys(username, ip, namespace)) {
      await lockRateLimitKey(tx, key)
      await tx.delete(loginRateLimits).where(eq(loginRateLimits.key, key))
    }
  })
}
