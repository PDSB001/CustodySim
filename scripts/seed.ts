import { eq } from "drizzle-orm"

import { hashPassword } from "../lib/auth"
import { ensureCustodyCheckinPresets } from "../lib/custody-checkin"
import { db } from "../lib/db"
import { organizations, persons, users } from "../lib/db/schema"

async function ensureOrganization({
  name,
  parentId,
  category,
  sort,
}: {
  name: string
  parentId: string | null
  category: string
  sort: number
}) {
  const [existing] = await db
    .select()
    .from(organizations)
    .where(eq(organizations.name, name))
    .limit(1)
  if (existing) {
    const [updated] = await db
      .update(organizations)
      .set({ parentId, category, sort, updatedAt: new Date() })
      .where(eq(organizations.id, existing.id))
      .returning()
    if (!updated) throw new Error(`无法更新组织：${name}`)
    return updated
  }
  const [created] = await db
    .insert(organizations)
    .values({ name, parentId, category, sort })
    .returning()
  if (!created) throw new Error(`无法创建组织：${name}`)
  return created
}

async function ensureUser({
  username,
  password,
  name,
  role,
  organizationId,
}: {
  username: string
  password: string
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
        organizationId,
        mustChangePassword: true,
        updatedAt: new Date(),
      })
      .where(eq(users.id, existing.id))
      .returning()
    if (!updated) throw new Error(`无法更新示例账号：${username}`)
    return updated
  }
  const [created] = await db
    .insert(users)
    .values({
      username,
      passwordHash: await hashPassword(password),
      name,
      role,
      organizationId,
      mustChangePassword: true,
    })
    .returning()
  if (!created) throw new Error(`无法创建示例账号：${username}`)
  return created
}

async function seed() {
  const root = await ensureOrganization({
    name: "CustodySim 管理中心",
    parentId: null,
    category: "ROOT",
    sort: 0,
  })
  const supervisionRoot = await ensureOrganization({
    name: "监管组织",
    parentId: root.id,
    category: "SUPERVISION_ROOT",
    sort: 0,
  })
  const [legacySupervisedRoot] = await db
    .select()
    .from(organizations)
    .where(eq(organizations.name, "被监管人员集合"))
    .limit(1)
  const [canonicalSupervisedRoot] = await db
    .select({ id: organizations.id })
    .from(organizations)
    .where(eq(organizations.name, "第一监狱"))
    .limit(1)
  if (legacySupervisedRoot && !canonicalSupervisedRoot)
    await db
      .update(organizations)
      .set({ name: "第一监狱", updatedAt: new Date() })
      .where(eq(organizations.id, legacySupervisedRoot.id))
  const supervisedRoot = await ensureOrganization({
    name: "第一监狱",
    parentId: root.id,
    category: "SUPERVISED_ROOT",
    sort: 1,
  })
  const supervisionUnit = await ensureOrganization({
    name: "示范监管单位",
    parentId: supervisionRoot.id,
    category: "SUPERVISION_UNIT",
    sort: 0,
  })
  const ward = await ensureOrganization({
    name: "一监区",
    parentId: supervisedRoot.id,
    category: "WARD",
    sort: 0,
  })
  const room = await ensureOrganization({
    name: "101 监室",
    parentId: ward.id,
    category: "ROOM",
    sort: 0,
  })
  await ensureUser({
    username: "admin",
    password: "admin123",
    name: "系统管理员",
    role: "ADMIN",
    organizationId: root.id,
  })
  await ensureUser({
    username: "supervisor",
    password: "supervisor123",
    name: "示范监管人",
    role: "SUPERVISOR",
    organizationId: supervisionUnit.id,
  })
  const supervised = await ensureUser({
    username: "user",
    password: "user12345",
    name: "示范被监管人",
    role: "SUPERVISED",
    organizationId: room.id,
  })
  const [existingPerson] = await db
    .select()
    .from(persons)
    .where(eq(persons.userId, supervised.id))
    .limit(1)
  if (existingPerson)
    await db
      .update(persons)
      .set({
        organizationId: room.id,
        custodyLevel: "GENERAL",
        custodyStatus: "IN_CUSTODY",
        updatedAt: new Date(),
      })
      .where(eq(persons.id, existingPerson.id))
  else
    await db.insert(persons).values({
      name: supervised.name,
      personType: "SUPERVISED",
      organizationId: room.id,
      userId: supervised.id,
      custodyLevel: "GENERAL",
      custodyStatus: "IN_CUSTODY",
    })
  await ensureCustodyCheckinPresets()
  console.info("组织骨架已就绪：机构 → 监管组织 / 第一监狱 → 监区 → 监室")
}

if (process.env.NODE_ENV === "production" || process.env.ALLOW_DEMO_SEED !== "true") {
  throw new Error(
    "演示数据初始化已禁用。仅限非生产环境且明确设置 ALLOW_DEMO_SEED=true 时执行。",
  )
}

seed().catch((error: unknown) => {
  console.error("初始化数据失败", error)
  process.exitCode = 1
})
