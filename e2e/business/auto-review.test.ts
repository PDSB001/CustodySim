import { randomUUID } from "node:crypto"
import { NextRequest } from "next/server"
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  expect,
  test,
  vi,
} from "vitest"
import { and, eq, inArray, sql } from "drizzle-orm"
import { signToken } from "@/lib/auth"
import { AUTH_COOKIE_NAME } from "@/lib/constants"
import { db } from "@/lib/db"
import * as s from "@/lib/db/schema"
import { runAutoReviewSweep } from "@/lib/auto-review-server"
import { GET, PUT } from "@/app/api/admin/auto-review/route"
import { getAutoReviewSettings } from "@/lib/auto-review-settings"
import { ISOLATION_REPORT_TEMPLATE_NAME } from "@/lib/isolation-report-template"
import { GET as listMakeups } from "@/app/api/makeups/route"
import { PATCH as reviewMakeup } from "@/app/api/makeups/[id]/route"

// 只替身 Next 的 cookie 读取；JWT 校验、角色判断与路由逻辑保持真实。
const cookie = vi.hoisted(() => ({ token: "" }))
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === AUTH_COOKIE_NAME ? { value: cookie.token } : undefined,
  }),
  // lib/session.ts 现在也读 Authorization 头（原生客户端路径）。这个 mock 是
  // 整体替换 next/headers，缺了 headers 会让所有鉴权路径直接抛错。
  headers: async () => new Headers(),
}))

const ids: string[] = []
const templates: string[] = []
const makeupFixtures: Array<{ id: string; taskId: string; ruleId: string }> = []
let user: string
let admin: string
let templateId: string
const snapshot = {
  content: "说明一项今天完成的工作与结果",
  fields: [{ name: "说明", type: "TEXTAREA", required: true, options: [] }],
}
const answers = { 说明: "今天整理书架，按类别摆放并清除了灰尘。" }
const approved = {
  result: "APPROVED",
  confidence: 0.95,
  reason: "内容具体，符合模板要求",
  issues: [],
}
const reply = (content = approved) =>
  Response.json({
    choices: [
      { finish_reason: "stop", message: { content: JSON.stringify(content) } },
    ],
  })
async function fixture(source = "RULE") {
  const [task] = await db
    .insert(s.reportTasks)
    .values({
      supervisedId: user,
      templateId,
      templateSnapshot: snapshot,
      title: "自动审核验证",
      source,
      status: "SUBMITTED",
      scheduleAt: new Date(Date.now() - 60_000),
      deadline: new Date(Date.now() + 3600_000),
    })
    .returning()
  const [submission] = await db
    .insert(s.reportSubmissions)
    .values({
      taskId: task!.id,
      userId: user,
      content: JSON.stringify(answers),
      data: answers,
    })
    .returning()
  return { task: task!, submission: submission! }
}
async function makeupFixture(photoUrl: string | null = null) {
  const [rule] = await db
    .insert(s.rules)
    .values({ name: `E2E ${randomUUID()}` })
    .returning()
  const [task] = await db
    .insert(s.checkinTasks)
    .values({
      ruleId: rule.id,
      supervisedId: user,
      slotIndex: 0,
      scheduleAt: new Date(),
      deadline: new Date(),
      status: "MAKEUP_PENDING",
    })
    .returning()
  const [makeup] = await db
    .insert(s.checkinMakeups)
    .values({
      taskId: task.id,
      userId: user,
      ruleId: rule.id,
      date: task.scheduleAt,
      slotIndex: 0,
      reason: "点名时手机没电，充电开机后申请补卡，避免当日记录缺失。",
      photoUrl,
    })
    .returning()
  makeupFixtures.push({ id: makeup.id, taskId: task.id, ruleId: rule.id })
  await db
    .update(s.autoReviewSettings)
    .set({ enabled: false, makeupEnabled: true })
  return makeup
}
beforeAll(async () => {
  expect(
    (await db.execute(sql`select current_database() as name`)).rows[0]?.name,
  ).toBe("custodysim_e2e")
})
beforeEach(async () => {
  user = randomUUID()
  admin = randomUUID()
  templateId = randomUUID()
  ids.push(user, admin)
  templates.push(templateId)
  await db.insert(s.users).values(
    [user, admin].map((id, i) => ({
      id,
      username: `e2e_${id}`,
      name: id,
      role: i ? "ADMIN" : "SUPERVISED",
      passwordHash: "unused",
      mustChangePassword: false,
    })),
  )
  await db
    .insert(s.reportTemplates)
    .values({ id: templateId, name: `E2E ${templateId}` })
  vi.stubEnv("GLM_PROVIDER", "bigmodel")
  vi.stubEnv("GLM_API_KEY", "e2e-placeholder")
  await db.delete(s.autoReviewSettings)
  await db.insert(s.autoReviewSettings).values({
    id: "default",
    enabled: true,
    provider: "bigmodel",
    actorId: admin,
    templateIds: [templateId],
  })
  cookie.token = await signToken({
    userId: admin,
    role: "ADMIN",
    tokenVersion: 0,
  })
})
afterEach(async () => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  if (makeupFixtures.length) {
    await db.delete(s.auditLogs).where(
      and(
        eq(s.auditLogs.entityType, "checkin_makeup"),
        inArray(
          s.auditLogs.entityId,
          makeupFixtures.map((row) => row.id),
        ),
      ),
    )
    await db.delete(s.checkinRecords).where(
      inArray(
        s.checkinRecords.taskId,
        makeupFixtures.map((row) => row.taskId),
      ),
    )
    await db.delete(s.checkinMakeups).where(
      inArray(
        s.checkinMakeups.id,
        makeupFixtures.map((row) => row.id),
      ),
    )
    await db.delete(s.checkinTasks).where(
      inArray(
        s.checkinTasks.id,
        makeupFixtures.map((row) => row.taskId),
      ),
    )
    await db.delete(s.rules).where(
      inArray(
        s.rules.id,
        makeupFixtures.map((row) => row.ruleId),
      ),
    )
    makeupFixtures.length = 0
  }
})
afterAll(async () => {
  await db.delete(s.autoReviewSettings)
  await db.delete(s.auditLogs).where(inArray(s.auditLogs.actorId, ids))
  // 自动审核写入的审计记录 actorId 为 null（系统级身份），需单独清理。
  await db
    .delete(s.auditLogs)
    .where(
      and(
        eq(s.auditLogs.actorType, "SYSTEM_AI"),
        eq(s.auditLogs.entityType, "report_submission"),
      ),
    )
  await db.delete(s.reportTasks).where(inArray(s.reportTasks.supervisedId, ids))
  await db.delete(s.scoreEvents).where(inArray(s.scoreEvents.supervisedId, ids))
  await db.delete(s.users).where(inArray(s.users.id, ids))
  await db
    .delete(s.reportTemplates)
    .where(inArray(s.reportTemplates.id, templates))
  await db.$client.end()
})

test("纯文字补卡调用模型后自动通过，审核轨迹区分 AI 身份", async () => {
  const makeup = await makeupFixture()
  const fetcher = vi.fn().mockResolvedValue(reply())
  vi.stubGlobal("fetch", fetcher)
  await runAutoReviewSweep()
  expect(fetcher).toHaveBeenCalledTimes(1)
  const response = await listMakeups(
    new NextRequest("http://localhost/api/makeups?status=APPROVED"),
  )
  expect(response.status).toBe(200)
  expect(
    (await response.json()).data.find(
      (row: { id: string }) => row.id === makeup.id,
    ),
  ).toMatchObject({
    status: "APPROVED",
    autoReviewReason: null,
    autoReviewHistory: [
      {
        status: "APPLIED",
        result: "APPROVED",
        reason: approved.reason,
        model: "glm-4.1v-thinking-flash",
        isCurrent: true,
      },
    ],
    reviewHistory: [
      {
        actorType: "SYSTEM_AI",
        actorName: "AI 自动审核",
        result: "APPROVED",
        comment: `自动审核：${approved.reason}`,
        isCurrent: true,
      },
    ],
  })
})

test("补卡限流降级原因可见，人工通过后仍保留自动审核和人工轨迹", async () => {
  const makeup = await makeupFixture()
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(new Response("rate limit", { status: 429 })),
  )
  await runAutoReviewSweep()
  const queue = (await (await listMakeups()).json()).data
  expect(
    queue.find((row: { id: string }) => row.id === makeup.id),
  ).toMatchObject({
    status: "PENDING",
    autoReviewReason: "模型服务暂不可用，请人工审核",
    autoReviewHistory: [
      { status: "MANUAL", result: "MANUAL", isCurrent: true },
    ],
    reviewHistory: [],
  })
  expect(
    (
      await reviewMakeup(
        new NextRequest("http://localhost/api/makeups", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            result: "APPROVED",
            comment: "核实后同意补卡",
          }),
        }),
        { params: Promise.resolve({ id: makeup.id }) },
      )
    ).status,
  ).toBe(200)
  const history = (
    await (
      await listMakeups(
        new NextRequest("http://localhost/api/makeups?status=APPROVED"),
      )
    ).json()
  ).data
  expect(
    history.find((row: { id: string }) => row.id === makeup.id),
  ).toMatchObject({
    status: "APPROVED",
    reviewComment: "核实后同意补卡",
    autoReviewReason: null,
    autoReviewHistory: [
      { reason: "模型服务暂不可用，请人工审核", result: "MANUAL" },
    ],
    reviewHistory: [
      {
        actorName: admin,
        actorType: "USER",
        result: "APPROVED",
        comment: "核实后同意补卡",
      },
    ],
  })
  const outsider = randomUUID()
  ids.push(outsider)
  await db.insert(s.users).values({
    id: outsider,
    username: `e2e_${outsider}`,
    name: outsider,
    role: "SUPERVISOR",
    passwordHash: "unused",
    mustChangePassword: false,
  })
  cookie.token = await signToken({
    userId: outsider,
    role: "SUPERVISOR",
    tokenVersion: 0,
  })
  expect(
    (
      await (
        await listMakeups(
          new NextRequest("http://localhost/api/makeups?status=ALL"),
        )
      ).json()
    ).data,
  ).toEqual([])
})

test("补卡重新申请不显示旧版本转人工提示，但保留历史原因", async () => {
  const makeup = await makeupFixture("data:image/png;base64,proof")
  const fetcher = vi.fn()
  vi.stubGlobal("fetch", fetcher)
  await runAutoReviewSweep()
  expect(fetcher).not.toHaveBeenCalled()
  await db
    .update(s.checkinMakeups)
    .set({
      reason: "重新申请，现已说明漏卡原因",
      createdAt: new Date(Date.now() + 1000),
    })
    .where(eq(s.checkinMakeups.id, makeup.id))
  expect(
    (await (await listMakeups()).json()).data.find(
      (row: { id: string }) => row.id === makeup.id,
    ),
  ).toMatchObject({
    status: "PENDING",
    autoReviewReason: null,
    autoReviewHistory: [
      {
        result: "MANUAL",
        reason: "补卡包含图片凭证，请人工核验",
        isCurrent: false,
      },
    ],
  })
})

test("自动通过与并发扫描只产生一份审核和积分", async () => {
  const row = await fixture()
  const fetcher = vi.fn().mockImplementation(() => Promise.resolve(reply()))
  vi.stubGlobal("fetch", fetcher)
  await Promise.all([runAutoReviewSweep(), runAutoReviewSweep()])
  await runAutoReviewSweep()
  expect(fetcher).toHaveBeenCalledTimes(1)
  expect(
    await db
      .select()
      .from(s.reportTasks)
      .where(eq(s.reportTasks.id, row.task.id)),
  ).toMatchObject([{ status: "APPROVED" }])
  expect(
    await db
      .select()
      .from(s.reportReviews)
      .where(eq(s.reportReviews.submissionId, row.submission.id)),
  ).toHaveLength(1)
  expect(
    await db
      .select()
      .from(s.scoreEvents)
      .where(eq(s.scoreEvents.supervisedId, user)),
  ).toMatchObject([{ points: 2 }])
})
test("重叠扫描共享数据库模型并发槽", async () => {
  await fixture()
  await fixture()
  vi.stubEnv("GLM_REVIEW_MAX_CONCURRENCY", "1")
  let signalFirstCallStarted!: () => void
  let releaseFirstCall!: () => void
  const firstCallStarted = new Promise<void>((resolve) => {
    signalFirstCallStarted = resolve
  })
  const firstCallGate = new Promise<void>((resolve) => {
    releaseFirstCall = resolve
  })
  let inFlight = 0
  let maxInFlight = 0
  const fetcher = vi.fn(async () => {
    inFlight += 1
    maxInFlight = Math.max(maxInFlight, inFlight)
    if (fetcher.mock.calls.length === 1) {
      signalFirstCallStarted()
      await firstCallGate
    }
    inFlight -= 1
    return reply()
  })
  vi.stubGlobal("fetch", fetcher)

  const firstSweep = runAutoReviewSweep()
  await firstCallStarted
  expect(await runAutoReviewSweep()).toBe(0)
  releaseFirstCall()
  await firstSweep

  expect(maxInFlight).toBe(1)
  expect(fetcher).toHaveBeenCalledTimes(2)
})
test("有证据的退回不加分，并保存修改说明", async () => {
  const row = await fixture()
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      reply({
        result: "RETURNED",
        confidence: 0.95,
        reason: "请说明具体结果",
        issues: [
          { field: "说明", quote: "今天整理书架", problem: "需要具体结果" },
        ],
      } as typeof approved),
    ),
  )
  await runAutoReviewSweep()
  expect(
    await db
      .select()
      .from(s.reportTasks)
      .where(eq(s.reportTasks.id, row.task.id)),
  ).toMatchObject([{ status: "RETURNED" }])
  expect(
    await db
      .select()
      .from(s.reportReviews)
      .where(eq(s.reportReviews.submissionId, row.submission.id)),
  ).toMatchObject([{ comment: "自动审核：请说明具体结果" }])
  expect(
    await db
      .select()
      .from(s.scoreEvents)
      .where(eq(s.scoreEvents.supervisedId, user)),
  ).toHaveLength(0)
})
test("GLM 限流转人工且不会循环重试", async () => {
  const row = await fixture()
  const fetcher = vi
    .fn()
    .mockResolvedValue(new Response("limited", { status: 429 }))
  vi.stubGlobal("fetch", fetcher)
  await runAutoReviewSweep()
  await runAutoReviewSweep()
  expect(fetcher).toHaveBeenCalledTimes(1)
  expect(
    await db
      .select()
      .from(s.reportTasks)
      .where(eq(s.reportTasks.id, row.task.id)),
  ).toMatchObject([{ status: "SUBMITTED" }])
  expect(
    await db
      .select()
      .from(s.autoReviewRuns)
      .where(eq(s.autoReviewRuns.submissionId, row.submission.id)),
  ).toMatchObject([{ result: "MANUAL" }])
})
test("模型等待期间任务取消，旧结论不计分", async () => {
  const row = await fixture()
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation(async () => {
      await db
        .update(s.reportTasks)
        .set({ status: "CANCELLED", updatedAt: new Date() })
        .where(eq(s.reportTasks.id, row.task.id))
      return reply()
    }),
  )
  await runAutoReviewSweep()
  expect(
    await db
      .select()
      .from(s.reportTasks)
      .where(eq(s.reportTasks.id, row.task.id)),
  ).toMatchObject([{ status: "CANCELLED" }])
  expect(
    await db
      .select()
      .from(s.scoreEvents)
      .where(eq(s.scoreEvents.supervisedId, user)),
  ).toHaveLength(0)
})
test("模型等待期间同时间戳内容改变，也不能使用旧结论", async () => {
  const row = await fixture()
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation(async () => {
      await db
        .update(s.reportSubmissions)
        .set({ data: { 说明: "变更后的内容" } })
        .where(eq(s.reportSubmissions.id, row.submission.id))
      return reply()
    }),
  )
  await runAutoReviewSweep()
  expect(
    await db
      .select()
      .from(s.reportTasks)
      .where(eq(s.reportTasks.id, row.task.id)),
  ).toMatchObject([{ status: "SUBMITTED" }])
  expect(
    await db
      .select()
      .from(s.scoreEvents)
      .where(eq(s.scoreEvents.supervisedId, user)),
  ).toHaveLength(0)
})
test("关闭功能以及禁闭检讨不调用模型", async () => {
  const row = await fixture("ISOLATION")
  const fetcher = vi.fn()
  vi.stubGlobal("fetch", fetcher)
  await db.update(s.autoReviewSettings).set({ enabled: false })
  expect(await runAutoReviewSweep()).toBe(0)
  await db.update(s.autoReviewSettings).set({ enabled: true })
  await runAutoReviewSweep()
  expect(fetcher).not.toHaveBeenCalled()
  expect(
    await db
      .select()
      .from(s.autoReviewRuns)
      .where(eq(s.autoReviewRuns.submissionId, row.submission.id)),
  ).toMatchObject([{ result: "MANUAL" }])
})

async function putSettings(patch: Record<string, unknown> = {}) {
  const { settings } = await getAutoReviewSettings()
  return PUT(
    new Request("http://localhost/api/admin/auto-review", {
      method: "PUT",
      body: JSON.stringify({ ...settings, ...patch }),
    }),
  )
}

test("管理员读取当前数据库账号和模板，密钥仅返回是否配置", async () => {
  const response = await GET()
  expect(response.status).toBe(200)
  const payload = await response.json()
  expect(payload.data.templates).toContainEqual({
    id: templateId,
    name: `E2E ${templateId}`,
    restricted: false,
  })
  expect(payload.data.actors.some((a: { id: string }) => a.id === admin)).toBe(
    true,
  )
  expect(payload.data.actors.some((a: { id: string }) => a.id === user)).toBe(
    false,
  )
  expect(payload.data.apiKeyConfigured).toBe(true)
  expect(payload.data.provider).toBe("bigmodel")
  expect(payload.data.model).toBe("glm-4.1v-thinking-flash")
  expect(payload.data.apiKeyVariable).toBe("GLM_API_KEY")
  expect(JSON.stringify(payload)).not.toContain("e2e-placeholder")
  expect(JSON.stringify(payload)).not.toContain("e2e-placeholder")
})

test("非管理员不能读取或修改配置", async () => {
  cookie.token = await signToken({
    userId: user,
    role: "SUPERVISED",
    tokenVersion: 0,
  })
  expect((await GET()).status).toBe(403)
  expect((await putSettings({ enabled: false })).status).toBe(403)
  expect((await getAutoReviewSettings()).settings.enabled).toBe(true)
})

test("开关保存立即影响扫描，写入审计并阻止旧版本覆盖", async () => {
  const previous = (await getAutoReviewSettings()).settings
  expect((await putSettings({ enabled: false })).status).toBe(200)
  await fixture()
  const fetcher = vi.fn().mockResolvedValue(reply())
  vi.stubGlobal("fetch", fetcher)
  expect(await runAutoReviewSweep()).toBe(0)
  const stale = await PUT(
    new Request("http://localhost/api/admin/auto-review", {
      method: "PUT",
      body: JSON.stringify(previous),
    }),
  )
  expect(stale.status).toBe(409)
  expect((await putSettings({ enabled: true })).status).toBe(200)
  await runAutoReviewSweep()
  expect(fetcher).toHaveBeenCalledTimes(1)
  expect(
    await db.select().from(s.auditLogs).where(eq(s.auditLogs.actorId, admin)),
  ).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        entityType: "auto_review_settings",
        actionLabel: "关闭自动审核",
      }),
      expect.objectContaining({
        entityType: "auto_review_settings",
        actionLabel: "更新自动审核设置",
      }),
    ]),
  )
})

test("首次保存并发只有一个成功，默认不继承环境变量开关", async () => {
  await db.delete(s.autoReviewSettings)
  vi.stubEnv("AUTO_TASK_REVIEW_ENABLED", "true")
  expect((await getAutoReviewSettings()).settings.enabled).toBe(false)
  const value = {
    enabled: false,
    makeupEnabled: false,
    provider: "bigmodel",
    actorId: admin,
    templateIds: [templateId],
    revision: null,
  }
  const results = await Promise.all(
    [1, 2].map(() =>
      PUT(
        new Request("http://localhost/api/admin/auto-review", {
          method: "PUT",
          body: JSON.stringify(value),
        }),
      ),
    ),
  )
  expect(results.map((r) => r.status).sort()).toEqual([200, 409])
})

test("启用校验密钥、账号权限、模板存在性及禁闭限制", async () => {
  vi.stubEnv("GLM_API_KEY", "")
  expect((await putSettings()).status).toBe(400)
  expect((await putSettings({ enabled: false })).status).toBe(200)
  vi.stubEnv("GLM_API_KEY", "e2e-placeholder")
  for (const patch of [
    { actorId: user },
    { actorId: null },
    { templateIds: [] },
    { templateIds: [randomUUID()] },
    { templateIds: [templateId, templateId] },
  ]) {
    expect((await putSettings({ enabled: true, ...patch })).status).toBe(400)
  }
  await db
    .update(s.reportTemplates)
    .set({ name: ISOLATION_REPORT_TEMPLATE_NAME })
    .where(eq(s.reportTemplates.id, templateId))
  expect((await putSettings({ enabled: true })).status).toBe(400)
  expect((await getAutoReviewSettings()).settings.enabled).toBe(false)
})

test.each(["关闭", "移除模板", "切换账号"])(
  "模型等待期间%s，旧结论不应用且后续候选不再外发",
  async (change) => {
    const row = await fixture()
    await fixture()
    const fetcher = vi.fn().mockImplementation(async () => {
      // Simulate an administrator committing a newer settings revision during inference.
      await db.update(s.autoReviewSettings).set({
        revision: randomUUID(),
        ...(change === "关闭"
          ? { enabled: false }
          : change === "移除模板"
            ? { templateIds: [] }
            : { actorId: user }),
      })
      return reply()
    })
    vi.stubGlobal("fetch", fetcher)
    await runAutoReviewSweep()
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(
      await db
        .select()
        .from(s.reportTasks)
        .where(eq(s.reportTasks.id, row.task.id)),
    ).toMatchObject([{ status: "SUBMITTED" }])
    expect(
      await db
        .select()
        .from(s.scoreEvents)
        .where(eq(s.scoreEvents.supervisedId, user)),
    ).toHaveLength(0)
  },
)
