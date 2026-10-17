import { randomUUID } from "node:crypto"
import { eq, inArray } from "drizzle-orm"
import { afterAll, expect, test } from "vitest"
import { db } from "@/lib/db"
import { users, persons, loginRateLimits } from "@/lib/db/schema"
import { guardAdminRemoval } from "@/lib/admin-membership"
import { getCustodyProfileForUser } from "@/lib/custody-checkin"
import {
  clearLoginFailures,
  getLoginRateLimitKeys,
  getLoginRetryAfterSeconds,
  recordLoginFailure,
} from "@/lib/login-rate-limit"

const ids: string[] = []
const limitKeys: string[] = []
async function account(role = "ADMIN") {
  const id = randomUUID()
  await db
    .insert(users)
    .values({
      id,
      username: `review_${id}`,
      name: "审查回归",
      passwordHash: "test-only",
      role,
    })
  ids.push(id)
  return id
}

afterAll(async () => {
  if (ids.length) await db.delete(users).where(inArray(users.id, ids))
  if (limitKeys.length)
    await db
      .delete(loginRateLimits)
      .where(inArray(loginRateLimits.key, limitKeys))
})

test.each(["delete", "disable"])(
  "concurrent administrators cannot %s each other",
  async (action) => {
    const [a, b] = await Promise.all([account(), account()])
    async function remove(actor: string, target: string) {
      return db.transaction(async (tx) => {
        await guardAdminRemoval(tx, actor, target)
        if (action === "delete")
          await tx.delete(users).where(eq(users.id, target))
        else
          await tx
            .update(users)
            .set({ status: "disabled" })
            .where(eq(users.id, target))
      })
    }
    const results = await Promise.allSettled([remove(a, b), remove(b, a)])
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1)
    const remaining = await db
      .select()
      .from(users)
      .where(inArray(users.id, [a, b]))
    expect(remaining.filter((user) => user.status === "active")).toHaveLength(1)
  },
)

test("custody status writes roll back with the location transaction", async () => {
  const id = await account("SUPERVISED")
  await db
    .insert(persons)
    .values({ userId: id, name: "事务回归", custodyStatus: "ON_LEAVE" })
  await expect(
    db.transaction(async (tx) => {
      expect((await getCustodyProfileForUser(id, tx))?.custodyStatus).toBe(
        "IN_CUSTODY",
      )
      throw new Error("rollback-fixture")
    }),
  ).rejects.toThrow("rollback-fixture")
  const [profile] = await db
    .select()
    .from(persons)
    .where(eq(persons.userId, id))
  expect(profile.custodyStatus).toBe("ON_LEAVE")
})

test("logging in as another account cannot clear network failures", async () => {
  const suffix = randomUUID()
  const ip = `review-network-${suffix}`
  const username = `review-account-${suffix}`
  const namespace = `review-${suffix}`
  limitKeys.push(...getLoginRateLimitKeys(username, ip, namespace))
  const now = new Date()
  for (let i = 0; i < 5; i++)
    await recordLoginFailure(username, ip, now, namespace)
  await clearLoginFailures(username, ip, namespace)
  expect(await getLoginRetryAfterSeconds(username, null, now, namespace)).toBe(
    0,
  )
  expect(
    await getLoginRetryAfterSeconds("another-account", ip, now, namespace),
  ).toBeGreaterThan(0)
})
