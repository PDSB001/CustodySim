import { and, eq } from "drizzle-orm"

import { hashPassword } from "../lib/auth"
import { buildDirectConversationKey } from "../lib/chat"
import { db } from "../lib/db"
import {
  chatConversationMembers,
  chatConversations,
  chatDirectRequests,
  organizations,
  persons,
  scoreEvents,
  scoreWeekReviews,
  supervisionRelationScopes,
  supervisionRelations,
  users,
} from "../lib/db/schema"
import { getShanghaiWeekKey } from "../lib/scoring"

const DEMO_PASSWORD = "Demo12345"

async function ensureOrganization(
  name: string,
  parentId: string | null,
  category: string,
) {
  const [existing] = await db
    .select()
    .from(organizations)
    .where(eq(organizations.name, name))
    .limit(1)
  if (existing) return existing
  const [created] = await db
    .insert(organizations)
    .values({ name, parentId, category, sort: 0 })
    .returning()
  if (!created) throw new Error(`无法创建演示组织：${name}`)
  return created
}

async function ensureUser({
  username,
  name,
  role,
  organizationId,
}: {
  username: string
  name: string
  role: "ADMIN" | "SUPERVISOR" | "SUPERVISED"
  organizationId: string
}) {
  const [existing] = await db
    .select()
    .from(users)
    .where(eq(users.username, username))
    .limit(1)
  if (existing) {
    const [updated] = await db
      .update(users)
      .set({
        name,
        passwordHash: await hashPassword(DEMO_PASSWORD),
        role,
        organizationId,
        status: "active",
        mustChangePassword: false,
        updatedAt: new Date(),
      })
      .where(eq(users.id, existing.id))
      .returning()
    if (!updated) throw new Error(`无法更新演示账号：${username}`)
    return updated
  }
  const [created] = await db
    .insert(users)
    .values({
      username,
      passwordHash: await hashPassword(DEMO_PASSWORD),
      name,
      role,
      organizationId,
      mustChangePassword: false,
    })
    .returning()
  if (!created) throw new Error(`无法创建演示账号：${username}`)
  return created
}

async function ensurePerson(user: typeof users.$inferSelect, roomId: string) {
  const [existing] = await db
    .select()
    .from(persons)
    .where(eq(persons.userId, user.id))
    .limit(1)
  if (existing) {
    await db
      .update(persons)
      .set({
        name: user.name,
        organizationId: roomId,
        custodyLevel: "GENERAL",
        custodyStatus: "IN_CUSTODY",
        status: "active",
        updatedAt: new Date(),
      })
      .where(eq(persons.id, existing.id))
    return
  }
  await db.insert(persons).values({
    name: user.name,
    personType: "SUPERVISED",
    organizationId: roomId,
    userId: user.id,
    custodyLevel: "GENERAL",
    custodyStatus: "IN_CUSTODY",
  })
}

async function ensureApprovedChatDemo({
  requesterId,
  targetId,
  adminId,
}: {
  requesterId: string
  targetId: string
  adminId: string
}) {
  const directKey = buildDirectConversationKey(requesterId, targetId)
  const [createdConversation] = await db
    .insert(chatConversations)
    .values({ type: "DIRECT", directKey, createdBy: requesterId })
    .onConflictDoNothing()
    .returning()
  const [existingConversation] = createdConversation
    ? [createdConversation]
    : await db
        .select()
        .from(chatConversations)
        .where(eq(chatConversations.directKey, directKey))
        .limit(1)
  if (!existingConversation) throw new Error("无法创建聊天演示会话")
  await db
    .insert(chatConversationMembers)
    .values([
      { conversationId: existingConversation.id, userId: requesterId },
      { conversationId: existingConversation.id, userId: targetId },
    ])
    .onConflictDoNothing()
  const [existingRequest] = await db
    .select({ id: chatDirectRequests.id })
    .from(chatDirectRequests)
    .where(
      and(
        eq(chatDirectRequests.requesterId, requesterId),
        eq(chatDirectRequests.targetId, targetId),
      ),
    )
    .limit(1)
  const values = {
    status: "APPROVED",
    reason: "E2E 初始化跨监室审批",
    comment: "E2E 初始化自动批准",
    reviewedBy: adminId,
    reviewedAt: new Date(),
    updatedAt: new Date(),
  }
  if (existingRequest)
    await db
      .update(chatDirectRequests)
      .set(values)
      .where(eq(chatDirectRequests.id, existingRequest.id))
  else
    await db.insert(chatDirectRequests).values({
      requesterId,
      targetId,
      ...values,
    })
}

function previousWeekKey(now = new Date()) {
  const current = getShanghaiWeekKey(now)
  const date = new Date(`${current}T00:00:00+08:00`)
  date.setUTCDate(date.getUTCDate() - 7)
  return getShanghaiWeekKey(date)
}

async function seed() {
  const root = await ensureOrganization("积分排行测试机构", null, "ROOT")
  const supervisionRoot = await ensureOrganization(
    "积分排行测试监管组织",
    root.id,
    "SUPERVISION_ROOT",
  )
  const supervisionUnit = await ensureOrganization(
    "积分排行测试监管单位",
    supervisionRoot.id,
    "SUPERVISION_UNIT",
  )
  const supervisedRoot = await ensureOrganization(
    "积分排行测试监狱",
    root.id,
    "SUPERVISED_ROOT",
  )
  const ward = await ensureOrganization(
    "积分排行测试监区",
    supervisedRoot.id,
    "WARD",
  )
  const room101 = await ensureOrganization("积分测试 101 监室", ward.id, "ROOM")
  const room102 = await ensureOrganization("积分测试 102 监室", ward.id, "ROOM")

  const admin = await ensureUser({
    username: "rank_admin",
    name: "排行测试管理员",
    role: "ADMIN",
    organizationId: root.id,
  })
  const supervisor = await ensureUser({
    username: "rank_supervisor",
    name: "排行测试监管人",
    role: "SUPERVISOR",
    organizationId: supervisionUnit.id,
  })
  const supervised = await Promise.all([
    ensureUser({
      username: "rank_101_liu",
      name: "刘晨",
      role: "SUPERVISED",
      organizationId: room101.id,
    }),
    ensureUser({
      username: "rank_101_zhou",
      name: "周宁",
      role: "SUPERVISED",
      organizationId: room101.id,
    }),
    ensureUser({
      username: "rank_102_sun",
      name: "孙敏",
      role: "SUPERVISED",
      organizationId: room102.id,
    }),
    ensureUser({
      username: "rank_102_tian",
      name: "田乐",
      role: "SUPERVISED",
      organizationId: room102.id,
    }),
  ])
  await Promise.all([
    ensurePerson(supervised[0], room101.id),
    ensurePerson(supervised[1], room101.id),
    ensurePerson(supervised[2], room102.id),
    ensurePerson(supervised[3], room102.id),
  ])
  await ensureApprovedChatDemo({
    requesterId: supervised[0].id,
    targetId: supervised[3].id,
    adminId: admin.id,
  })

  let [relation] = await db
    .select()
    .from(supervisionRelations)
    .where(eq(supervisionRelations.name, "积分排行测试监管关系"))
    .limit(1)
  if (!relation) {
    ;[relation] = await db
      .insert(supervisionRelations)
      .values({ name: "积分排行测试监管关系", status: "active" })
      .returning()
  }
  if (!relation) throw new Error("无法创建演示监管关系")
  const scopes = await db
    .select()
    .from(supervisionRelationScopes)
    .where(eq(supervisionRelationScopes.relationId, relation.id))
  const expectedScopes = [
    { side: "SUPERVISOR", targetType: "USER", targetId: supervisor.id },
    ...supervised.map((user) => ({
      side: "SUPERVISED",
      targetType: "USER",
      targetId: user.id,
    })),
  ]
  const missingScopes = expectedScopes.filter(
    (scope) =>
      !scopes.some(
        (existing) =>
          existing.side === scope.side &&
          existing.targetType === scope.targetType &&
          existing.targetId === scope.targetId,
      ),
  )
  if (missingScopes.length)
    await db
      .insert(supervisionRelationScopes)
      .values(
        missingScopes.map((scope) => ({ ...scope, relationId: relation.id })),
      )

  const currentWeek = getShanghaiWeekKey()
  const historicalWeek = previousWeekKey()
  const currentScores = [8, 4, 1, -3]
  const historicalScores = [6, -2, 3, 0]
  for (const [index, user] of supervised.entries()) {
    const sourceId = `10000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`
    await db
      .insert(scoreEvents)
      .values({
        supervisedId: user.id,
        points: currentScores[index] ?? 0,
        reason: "积分排行演示：本周汇总",
        source: "DEMO_SCORE_CURRENT",
        sourceId,
        weekKey: currentWeek,
      })
      .onConflictDoUpdate({
        target: [scoreEvents.source, scoreEvents.sourceId],
        set: {
          points: currentScores[index] ?? 0,
          reason: "积分排行演示：本周汇总",
          weekKey: currentWeek,
        },
      })
    const historicalSourceId = `20000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`
    await db
      .insert(scoreEvents)
      .values({
        supervisedId: user.id,
        points: historicalScores[index] ?? 0,
        reason: "积分排行演示：历史周汇总",
        source: "DEMO_SCORE_HISTORY",
        sourceId: historicalSourceId,
        weekKey: historicalWeek,
      })
      .onConflictDoUpdate({
        target: [scoreEvents.source, scoreEvents.sourceId],
        set: {
          points: historicalScores[index] ?? 0,
          reason: "积分排行演示：历史周汇总",
          weekKey: historicalWeek,
        },
      })
    await db
      .insert(scoreWeekReviews)
      .values({
        supervisedId: user.id,
        weekKey: historicalWeek,
        totalScore: historicalScores[index] ?? 0,
        result: (historicalScores[index] ?? 0) < 0 ? "ISOLATION" : "CLEAR",
      })
      .onConflictDoUpdate({
        target: [scoreWeekReviews.supervisedId, scoreWeekReviews.weekKey],
        set: {
          totalScore: historicalScores[index] ?? 0,
          result: (historicalScores[index] ?? 0) < 0 ? "ISOLATION" : "CLEAR",
        },
      })
  }
  console.info(
    "积分排行演示账号已就绪：rank_admin、rank_supervisor、rank_101_liu、rank_101_zhou、rank_102_sun、rank_102_tian",
  )
}

if (
  process.env.NODE_ENV === "production" ||
  process.env.ALLOW_DEMO_SEED !== "true"
)
  throw new Error(
    "演示积分账号只能在非生产环境并设置 ALLOW_DEMO_SEED=true 时创建。",
  )

seed().catch((error: unknown) => {
  console.error("积分排行演示数据初始化失败", error)
  process.exitCode = 1
})
