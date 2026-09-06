import { randomUUID } from "node:crypto"
import { afterAll, beforeAll, expect, test, vi } from "vitest"
import { eq, inArray, sql } from "drizzle-orm"
import { NextRequest } from "next/server"
import { db } from "@/lib/db"
import * as s from "@/lib/db/schema"
import { hashPassword, signToken, verifyPassword } from "@/lib/auth"
import { AUTH_COOKIE_NAME } from "@/lib/constants"
import * as audit from "@/lib/audit"
import { POST as changePassword } from "@/app/api/auth/change-password/route"
import { POST as apply } from "@/app/api/applications/route"
import { PATCH as reviewApplication } from "@/app/api/application-reviews/[id]/route"

const cookie = vi.hoisted(() => ({ token: "" }))
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === AUTH_COOKIE_NAME ? { value: cookie.token } : undefined,
  }),
}))
const ids: string[] = []
const originalPassword = "BeforeChange123"
let passwordHash: string
async function account(role: "SUPERVISED" | "ADMIN" = "SUPERVISED") {
  const id = randomUUID()
  ids.push(id)
  await db
    .insert(s.users)
    .values({
      id,
      username: `e2e_${id}`,
      name: `e2e_${id}`,
      passwordHash,
      role,
      mustChangePassword: false,
    })
  cookie.token = await signToken({ userId: id, role, tokenVersion: 0 })
  return id
}
function request(body: unknown) {
  return new NextRequest("http://localhost/api/e2e", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}
beforeAll(async () => {
  expect(
    (await db.execute(sql`select current_database() as name`)).rows[0]?.name,
  ).toBe("custodysim_e2e")
  passwordHash = await hashPassword(originalPassword)
})
afterAll(async () => {
  if (ids.length) {
    await db.delete(s.auditLogs).where(inArray(s.auditLogs.actorId, ids))
    await db.delete(s.applications).where(inArray(s.applications.userId, ids))
    await db.delete(s.users).where(inArray(s.users.id, ids))
  }
  await db.$client.end()
})

test("并发改密只能成功一次，不能覆盖新密码并复用会话版本", async () => {
  const id = await account()
  const passwords = ["FirstChange123", "SecondChange456"]
  const blocker = await db.$client.connect()
  let pending: Promise<Response>[] = []
  try {
    await blocker.query("BEGIN")
    await blocker.query("select id from users where id = $1 for update", [id])
    pending = passwords.map((newPassword) =>
      changePassword(
        request({
          currentPassword: originalPassword,
          newPassword,
          confirmPassword: newPassword,
        }),
      ),
    )
    await expect
      .poll(
        async () => {
          const waiting = await db.execute(
            sql`select count(*)::int as count from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock' and query like '%users%'`,
          )
          return waiting.rows[0]?.count
        },
        { timeout: 10_000 },
      )
      .toBe(2)
    await blocker.query("COMMIT")
    const responses = await Promise.all(pending)
    expect(responses.map((response) => response.status).sort()).toEqual([
      200, 409,
    ])
    const winner = responses.findIndex((response) => response.status === 200)
    const [updated] = await db.select().from(s.users).where(eq(s.users.id, id))
    expect(updated?.tokenVersion).toBe(1)
    expect(
      await verifyPassword(passwords[winner]!, updated!.passwordHash),
    ).toBe(true)
    expect(
      await db.select().from(s.auditLogs).where(eq(s.auditLogs.actorId, id)),
    ).toHaveLength(1)
    // The original JWT must no longer authorize another password change.
    expect(
      (
        await changePassword(
          request({
            currentPassword: passwords[winner],
            newPassword: "ThirdChange789",
            confirmPassword: "ThirdChange789",
          }),
        )
      ).status,
    ).toBe(401)
  } finally {
    await blocker.query("ROLLBACK")
    blocker.release()
    await Promise.all(pending)
  }
})

test("申请提交审计失败时，申请与审核队列一起回滚", async () => {
  const id = await account()
  const failure = vi
    .spyOn(audit, "writeAuditLog")
    .mockRejectedValueOnce(new Error("E2E audit unavailable"))
  const logged = vi.spyOn(console, "error").mockImplementation(() => {})
  try {
    expect(
      (await apply(request({ type: "GENERAL", reason: "事务验证" }))).status,
    ).toBe(500)
    expect(
      await db
        .select()
        .from(s.applications)
        .where(eq(s.applications.userId, id)),
    ).toHaveLength(0)
  } finally {
    failure.mockRestore()
    logged.mockRestore()
  }
  const response = await apply(request({ type: "GENERAL", reason: "事务验证" }))
  expect(response.status).toBe(201)
  const created = (await response.json()).data
  expect(
    await db.select().from(s.applications).where(eq(s.applications.userId, id)),
  ).toHaveLength(1)
  expect(
    (
      await db
        .select()
        .from(s.applicationReviews)
        .where(eq(s.applicationReviews.applicationId, created.id))
    ).length,
  ).toBeGreaterThan(0)
  expect(
    await db
      .select()
      .from(s.auditLogs)
      .where(eq(s.auditLogs.entityId, created.id)),
  ).toHaveLength(1)
})

test("申请审批审计失败时，审批结果与申请状态一起回滚", async () => {
  const user = await account()
  const admin = await account("ADMIN")
  const [application] = await db
    .insert(s.applications)
    .values({
      userId: user,
      type: "GENERAL",
      title: "事务验证",
      reason: "测试",
      status: "PENDING_REVIEW",
    })
    .returning()
  const [review] = await db
    .insert(s.applicationReviews)
    .values({
      applicationId: application!.id,
      reviewerId: admin,
      step: 0,
      result: "PENDING",
    })
    .returning()
  const context = { params: Promise.resolve({ id: review!.id }) }
  const failure = vi
    .spyOn(audit, "writeAuditLog")
    .mockRejectedValueOnce(new Error("E2E audit unavailable"))
  const logged = vi.spyOn(console, "error").mockImplementation(() => {})
  try {
    expect(
      (await reviewApplication(request({ result: "APPROVED" }), context))
        .status,
    ).toBe(500)
    expect(
      await db
        .select()
        .from(s.applications)
        .where(eq(s.applications.id, application!.id)),
    ).toMatchObject([{ status: "PENDING_REVIEW", officialSealData: null }])
    expect(
      await db
        .select()
        .from(s.applicationReviews)
        .where(eq(s.applicationReviews.id, review!.id)),
    ).toMatchObject([{ result: "PENDING", reviewedAt: null }])
  } finally {
    failure.mockRestore()
    logged.mockRestore()
  }
  expect(
    (await reviewApplication(request({ result: "APPROVED" }), context)).status,
  ).toBe(200)
  expect(
    (await reviewApplication(request({ result: "APPROVED" }), context)).status,
  ).toBe(409)
  expect(
    await db
      .select()
      .from(s.auditLogs)
      .where(eq(s.auditLogs.entityId, application!.id)),
  ).toHaveLength(1)
})
