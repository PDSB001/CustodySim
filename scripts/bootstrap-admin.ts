import { eq } from "drizzle-orm"

import { LoginSchema } from "../lib/auth-schemas"
import { hashPassword } from "../lib/auth"
import { db } from "../lib/db"
import { organizations, users } from "../lib/db/schema"
import { validatePassword } from "../lib/password-rule"

const username = process.env.INITIAL_ADMIN_USERNAME?.trim()
const password = process.env.INITIAL_ADMIN_PASSWORD
const name = process.env.INITIAL_ADMIN_NAME?.trim() || "系统管理员"
const organizationName =
  process.env.INITIAL_ADMIN_ORGANIZATION_NAME?.trim() || "CustodySim 管理中心"

async function bootstrapAdmin() {
  if (!username || !password)
    throw new Error(
      "必须通过 INITIAL_ADMIN_USERNAME 和 INITIAL_ADMIN_PASSWORD 提供一次性初始管理员凭据。",
    )
  if (!LoginSchema.safeParse({ username, password }).success)
    throw new Error("初始管理员用户名或密码格式不合法。")
  const passwordCheck = validatePassword(password)
  if (!passwordCheck.valid)
    throw new Error(`初始管理员密码不符合要求：${passwordCheck.errors.join("；")}`)

  const [existingAdmin] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.role, "ADMIN"))
    .limit(1)
  if (existingAdmin)
    throw new Error("系统已存在管理员，拒绝再次执行初始管理员引导。")

  const [organization] = await db
    .select({ id: organizations.id })
    .from(organizations)
    .where(eq(organizations.name, organizationName))
    .limit(1)
  const organizationId = organization
    ? organization.id
    : (
        await db
          .insert(organizations)
          .values({ name: organizationName, parentId: null, category: "ROOT", sort: 0 })
          .returning({ id: organizations.id })
      )[0]?.id
  if (!organizationId) throw new Error("创建初始管理员组织失败。")

  await db.insert(users).values({
    username,
    passwordHash: await hashPassword(password),
    name,
    role: "ADMIN",
    organizationId,
    mustChangePassword: true,
    passwordMeta: JSON.stringify(passwordCheck.meta),
  })
  console.info("初始管理员已创建；请立即登录并完成改密，然后移除 INITIAL_ADMIN_PASSWORD。")
}

bootstrapAdmin().catch((error: unknown) => {
  console.error("初始管理员引导失败", error)
  process.exitCode = 1
})
