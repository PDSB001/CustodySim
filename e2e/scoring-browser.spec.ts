import { randomUUID } from "node:crypto"
import { expect, test } from "@playwright/test"
import { eq, inArray, sql } from "drizzle-orm"
import * as s from "../lib/db/schema"
import { hashPassword } from "../lib/auth"

test("管理员页面读取当前环境模板，保存设置并在刷新后保留", async ({
  page,
  playwright,
  baseURL,
}, testInfo) => {
  const admin = randomUUID()
  const templateIds = [randomUUID(), randomUUID()]
  const templateNames = templateIds.map((id) => `当前环境审核模板 ${id}`)
  const password = "E2eSettings12345"
  const anonymous = await playwright.request.newContext({ baseURL })
  try {
    expect((await anonymous.get("/api/admin/auto-review")).status()).toBe(403)
    await db.delete(s.autoReviewSettings)
    await db.insert(s.users).values({
      id: admin,
      username: `e2e_${admin}`,
      name: "自动审核设置测试管理员",
      role: "ADMIN",
      passwordHash: await hashPassword(password),
      mustChangePassword: false,
    })
    await db
      .insert(s.reportTemplates)
      .values(
        templateIds.map((id, index) => ({ id, name: templateNames[index] })),
      )
    await page.goto("/login")
    await page.getByLabel("账号").fill(`e2e_${admin}`)
    await page.getByLabel("密码").fill(password)
    await page.getByRole("button", { name: /登\s*录/ }).click()
    await expect(page).toHaveURL(`${baseURL}/`)
    await page.goto("/auto-review")
    await expect(
      page.getByRole("heading", { name: "自动审核", exact: true }),
    ).toBeVisible()
    await expect(
      page.getByText("API Key：未配置，请在服务端设置 GLM_API_KEY"),
    ).toBeVisible()
    await page.getByLabel("审核账号", { exact: true }).selectOption(admin)
    await page.getByLabel(templateNames[0], { exact: true }).check()
    await page.getByLabel(templateNames[1], { exact: true }).check()
    await page.getByRole("switch", { name: "启用自动审核" }).check()
    await expect(
      page.getByRole("button", { name: "保存设置", exact: true }),
    ).toBeDisabled()
    await page.getByRole("switch", { name: "启用自动审核" }).uncheck()
    const saved = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/admin/auto-review") &&
        response.request().method() === "PUT",
    )
    await page.getByRole("button", { name: "保存设置", exact: true }).click()
    expect((await saved).status()).toBe(200)
    await page.reload()
    await expect(page.getByLabel("审核账号", { exact: true })).toHaveValue(
      admin,
    )
    await expect(
      page.getByLabel(templateNames[0], { exact: true }),
    ).toBeChecked()
    await expect(
      page.getByLabel(templateNames[1], { exact: true }),
    ).toBeChecked()
    await expect(
      page.getByRole("switch", { name: "启用自动审核" }),
    ).not.toBeChecked()
    const payload = await (
      await page.request.get("/api/admin/auto-review")
    ).json()
    expect(payload.data.settings).toMatchObject({
      enabled: false,
      actorId: admin,
      templateIds,
    })
    expect(payload.data).not.toHaveProperty("apiKey")
    await page.screenshot({
      path: `.logs/auto-review-${testInfo.project.name}.png`,
      fullPage: true,
    })
  } finally {
    await anonymous.dispose()
    await db.delete(s.autoReviewSettings)
    await db.delete(s.auditLogs).where(eq(s.auditLogs.actorId, admin))
    await db.delete(s.loginLogs).where(eq(s.loginLogs.userId, admin))
    await db.delete(s.users).where(eq(s.users.id, admin))
    await db
      .delete(s.reportTemplates)
      .where(inArray(s.reportTemplates.id, templateIds))
  }
})

let db: typeof import("../lib/db").db
let getShanghaiWeekKey: typeof import("../lib/scoring").getShanghaiWeekKey
let runWeeklyScoreReview: typeof import("../lib/scoring").runWeeklyScoreReview
test.beforeAll(async () => {
  const url = process.env.E2E_SCORING_DATABASE_URL
  if (!url || new URL(url).pathname !== "/custodysim_e2e")
    throw new Error("Run with playwright.scoring.config.ts")
  process.env.DATABASE_URL = url
  ;({ db } = await import("../lib/db"))
  ;({ getShanghaiWeekKey, runWeeklyScoreReview } =
    await import("../lib/scoring"))
})

test("真实登录、提交审核后更正上周积分，取消的检讨在页面与 API 均不可提交", async ({
  page,
  playwright,
  baseURL,
}) => {
  expect(
    (await db.execute(sql`select current_database() as name`)).rows[0]?.name,
  ).toBe("custodysim_e2e")
  const user = randomUUID()
  const admin = randomUUID()
  const ids = [user, admin]
  const password = "E2eScore12345"
  const passwordHash = await hashPassword(password)
  const now = new Date()
  const weekStart = new Date(`${getShanghaiWeekKey(now)}T00:00:00+08:00`)
  const sunday = new Date(weekStart.getTime() - 30 * 60_000)
  const weekKey = getShanghaiWeekKey(sunday)
  const deadline = new Date(now.getTime() + 86_400_000)
  const adminApi = await playwright.request.newContext({ baseURL })
  try {
    await db.insert(s.users).values(
      ids.map((id, i) => ({
        id,
        username: `e2e_${id}`,
        name: `e2e_${id}`,
        passwordHash,
        role: i ? "ADMIN" : "SUPERVISED",
        mustChangePassword: false,
      })),
    )
    await db
      .insert(s.persons)
      .values({ userId: user, name: user, custodyStatus: "ISOLATION" })
    await db.insert(s.scoreEvents).values({
      supervisedId: user,
      points: -1,
      reason: "E2E fixture",
      source: "MANUAL",
      weekKey,
    })
    await db.insert(s.scoreWeekReviews).values({
      supervisedId: user,
      weekKey,
      totalScore: -1,
      result: "ISOLATION",
    })
    const [order] = await db
      .insert(s.isolationOrders)
      .values({
        supervisedId: user,
        weekKey,
        triggerScore: -1,
        previousCustodyStatus: "IN_CUSTODY",
        startAt: sunday,
        endAt: deadline,
      })
      .returning()
    const [task, reflection] = await db
      .insert(s.reportTasks)
      .values([
        {
          supervisedId: user,
          title: "跨周审核验证",
          scheduleAt: sunday,
          deadline,
          templateSnapshot: { fields: [] },
        },
        {
          supervisedId: user,
          title: "应撤销的反思任务",
          scheduleAt: sunday,
          deadline,
          source: "ISOLATION",
          templateSnapshot: { fields: [] },
        },
      ])
      .returning()
    await db.insert(s.isolationReflectionTasks).values({
      isolationOrderId: order!.id,
      taskId: reflection!.id,
      dayKey: getShanghaiWeekKey(now),
    })

    await page.goto("/login")
    await page.getByLabel("账号").fill(`e2e_${user}`)
    await page.getByLabel("密码").fill(password)
    await page.getByRole("button", { name: /登\s*录/ }).click()
    await expect(page).toHaveURL(/\/my$/)
    const submitted = await page.request.post("/api/submissions", {
      data: { taskId: task!.id, data: {} },
    })
    expect(submitted.status()).toBe(201)
    const submissionId = (await submitted.json()).data.id
    expect(
      (
        await adminApi.post("/api/auth/login", {
          data: { username: `e2e_${admin}`, password },
        })
      ).ok(),
    ).toBe(true)
    expect(
      (
        await adminApi.post("/api/reviews", {
          data: { submissionId, result: "APPROVED" },
        })
      ).status(),
    ).toBe(201)
    expect(
      (
        await adminApi.post("/api/reviews", {
          data: { submissionId, result: "APPROVED" },
        })
      ).status(),
    ).toBe(409)
    await runWeeklyScoreReview(now)
    expect(
      await db
        .select()
        .from(s.scoreWeekReviews)
        .where(eq(s.scoreWeekReviews.supervisedId, user)),
    ).toMatchObject([{ totalScore: 1, result: "CLEAR" }])
    expect(
      await db
        .select()
        .from(s.isolationOrders)
        .where(eq(s.isolationOrders.id, order!.id)),
    ).toMatchObject([{ status: "CANCELLED" }])
    expect(
      (
        await page.request.post("/api/submissions", {
          data: { taskId: reflection!.id, data: {} },
        })
      ).status(),
    ).toBe(400)
    expect(
      (
        await page.request.post("/api/submissions/draft", {
          data: { taskId: reflection!.id, data: {} },
        })
      ).status(),
    ).toBe(400)
    await page.goto("/my/tasks")
    const card = page
      .locator('[data-slot="card"]')
      .filter({ hasText: "应撤销的反思任务" })
    await expect(card).toContainText("已取消")
    await expect(card.getByRole("button", { name: "提交任务" })).toHaveCount(0)
  } finally {
    await adminApi.dispose()
    await db.delete(s.auditLogs).where(inArray(s.auditLogs.actorId, ids))
    await db.delete(s.loginLogs).where(inArray(s.loginLogs.userId, ids))
    await db
      .delete(s.isolationOrders)
      .where(eq(s.isolationOrders.supervisedId, user))
    await db.delete(s.reportTasks).where(eq(s.reportTasks.supervisedId, user))
    await db.delete(s.checkinTasks).where(eq(s.checkinTasks.supervisedId, user))
    await db
      .delete(s.checkinDailyScores)
      .where(eq(s.checkinDailyScores.supervisedId, user))
    await db.delete(s.scoreEvents).where(eq(s.scoreEvents.supervisedId, user))
    await db
      .delete(s.scoreWeekReviews)
      .where(eq(s.scoreWeekReviews.supervisedId, user))
    await db.delete(s.persons).where(eq(s.persons.userId, user))
    await db
      .delete(s.notices)
      .where(sql`${s.notices.content} like ${`%e2e_${user}%`}`)
    await db.delete(s.users).where(inArray(s.users.id, ids))
  }
})

test.afterAll(async () => {
  await db.$client.end()
})
