import { randomUUID } from "node:crypto"
import { afterAll, afterEach, beforeAll, expect, test, vi } from "vitest"
import { eq, inArray, sql } from "drizzle-orm"
import { NextRequest } from "next/server"
import { hashPassword, signToken } from "@/lib/auth"
import * as auth from "@/lib/auth"
import { AUTH_COOKIE_NAME } from "@/lib/constants"
import { db } from "@/lib/db"
import * as s from "@/lib/db/schema"
import { encryptMfaSecret } from "@/lib/mfa"
import { NATIVE_CLIENT_HEADER } from "@/lib/native-client"
import { POST as login } from "@/app/api/auth/login/route"
import { POST as refresh } from "@/app/api/auth/refresh/route"
import { POST as verifyMfa } from "@/app/api/auth/mfa/verify/route"
import { POST as logout } from "@/app/api/auth/logout/route"
import { GET as getMe } from "@/app/api/me/route"
import { PATCH as updateUser } from "@/app/api/admin/users/[id]/route"
import { POST as resetPassword } from "@/app/api/admin/users/[id]/reset-password/route"
import { getSessionUser } from "@/lib/session"

// 整体替换 next/headers：cookie 走浏览器路径，Authorization 走原生客户端路径。
// JWT 校验、角色判断、令牌轮换与路由逻辑全部保持真实。
const cookie = vi.hoisted(() => ({ token: "" }))
const authHeader = vi.hoisted(() => ({ value: null as string | null }))
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === AUTH_COOKIE_NAME ? { value: cookie.token } : undefined,
  }),
  headers: async () =>
    new Headers(
      authHeader.value !== null ? { authorization: authHeader.value } : {},
    ),
}))

const PASSWORD = "NativeApp123"
const ids: string[] = []
let passwordHash = ""

async function account(role: "SUPERVISED" | "SUPERVISOR" | "ADMIN") {
  const id = randomUUID()
  ids.push(id)
  await db.insert(s.users).values({
    id,
    username: `e2e_${id}`,
    name: `e2e_${id}`,
    passwordHash,
    role,
    mustChangePassword: false,
  })
  return id
}

/** native=true 时带上原生客户端头，这是写请求豁免同源校验的依据。 */
function request(body: unknown, native: boolean) {
  return new NextRequest("http://localhost/api/e2e", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(native ? { [NATIVE_CLIENT_HEADER]: "android-app/1" } : {}),
    },
    body: JSON.stringify(body),
  })
}

function setBearer(token: string) {
  cookie.token = ""
  authHeader.value = `Bearer ${token}`
}

function clearAuth() {
  cookie.token = ""
  authHeader.value = null
}

async function nativeLogin(user: string) {
  const response = await login(
    request({ username: `e2e_${user}`, password: PASSWORD }, true),
  )
  expect(response.status).toBe(200)
  return (await response.json()).data as {
    id: string
    token?: string
    refreshToken?: string
    expiresInSeconds?: number
    requiresMfa?: boolean
    mfaToken?: string
  }
}

beforeAll(async () => {
  expect(
    (await db.execute(sql`select current_database() as name`)).rows[0]?.name,
  ).toBe("custodysim_e2e")
  passwordHash = await hashPassword(PASSWORD)
})

afterEach(() => {
  clearAuth()
  vi.restoreAllMocks()
})

afterAll(async () => {
  if (ids.length) {
    await db.delete(s.auditLogs).where(inArray(s.auditLogs.actorId, ids))
    await db.delete(s.refreshTokens).where(inArray(s.refreshTokens.userId, ids))
    await db.delete(s.mfaFactors).where(inArray(s.mfaFactors.userId, ids))
    await db
      .delete(s.mfaLoginChallenges)
      .where(inArray(s.mfaLoginChallenges.userId, ids))
    await db.delete(s.loginLogs).where(inArray(s.loginLogs.userId, ids))
    await db.delete(s.users).where(inArray(s.users.id, ids))
  }
  await db.$client.end()
})

test("原生登录在响应体返回访问令牌与刷新令牌，浏览器登录不返回", async () => {
  const user = await account("SUPERVISED")

  const browserResponse = await login(
    request({ username: `e2e_${user}`, password: PASSWORD }, false),
  )
  expect(browserResponse.status).toBe(200)
  const browserBody = (await browserResponse.json()).data
  // 浏览器必须依赖 httpOnly cookie，令牌不得出现在响应体里（避免 XSS 读取）。
  expect(browserBody.token).toBeUndefined()
  expect(browserBody.refreshToken).toBeUndefined()
  expect(browserBody.id).toBe(user)

  const nativeBody = await nativeLogin(user)
  expect(typeof nativeBody.token).toBe("string")
  expect(typeof nativeBody.refreshToken).toBe("string")
  expect(nativeBody.expiresInSeconds).toBe(28_800)
})

test("Bearer 令牌可独立完成鉴权，不需要 cookie", async () => {
  const user = await account("SUPERVISED")
  const session = await nativeLogin(user)
  setBearer(session.token!)

  const response = await getMe()
  expect(response.status).toBe(200)
  const body = (await response.json()).data
  expect(body.id).toBe(user)
  expect(body.role).toBe("SUPERVISED")
})

test.each(["Basic invalid", "Bearer", "Bearer ", "", "Bearer invalid"])(
  "Authorization=%j 时拒绝回退到有效的浏览器 Cookie",
  async (authorization) => {
    const user = await account("SUPERVISED")
    const session = await nativeLogin(user)
    cookie.token = session.token!
    authHeader.value = authorization
    expect((await getMe()).status).toBe(401)
  },
)

test("Bearer 方案名不区分大小写，且显式身份优先于 Cookie", async () => {
  const first = await account("SUPERVISED")
  const second = await account("SUPERVISED")
  cookie.token = (await nativeLogin(first)).token!
  authHeader.value = `bearer ${(await nativeLogin(second)).token}`
  const response = await getMe()
  expect(response.status).toBe(200)
  expect((await response.json()).data.id).toBe(second)
})

test("账号停用并重新启用后，旧访问令牌、刷新令牌和受信任设备不复活", async () => {
  const admin = await account("ADMIN")
  const user = await account("ADMIN")
  const session = await nativeLogin(user)
  const adminToken = await signToken({
    userId: admin,
    role: "ADMIN",
    tokenVersion: 0,
  })
  const [device] = await db
    .insert(s.mfaTrustedDevices)
    .values({
      userId: user,
      tokenHash: randomUUID().replaceAll("-", "").repeat(2),
      label: "revocation regression",
      expiresAt: new Date(Date.now() + 86400000),
    })
    .returning()
  const context = { params: Promise.resolve({ id: user }) }
  for (const status of ["disabled", "active"]) {
    clearAuth()
    cookie.token = adminToken
    const response = await updateUser(
      request({ name: "会话撤销测试", role: "ADMIN", status }, false),
      context,
    )
    expect(response.status).toBe(200)
    setBearer(session.token!)
    expect((await getMe()).status).toBe(401)
    expect(
      (await refresh(request({ refreshToken: session.refreshToken }, true)))
        .status,
    ).toBe(401)
  }
  const [revoked] = await db
    .select()
    .from(s.mfaTrustedDevices)
    .where(eq(s.mfaTrustedDevices.id, device.id))
  expect(revoked.revokedAt).not.toBeNull()
  clearAuth()
  setBearer((await nativeLogin(user)).token!)
  expect((await getMe()).status).toBe(200)
})

test("密码重置并发遇到会话撤销时，版本仍递增且中途签发的令牌失效", async () => {
  const admin = await account("ADMIN")
  const user = await account("ADMIN")
  cookie.token = await signToken({
    userId: admin,
    role: "ADMIN",
    tokenVersion: 0,
  })
  let announceHash!: () => void
  let resumeHash!: () => void
  const hashing = new Promise<void>((resolve) => {
    announceHash = resolve
  })
  const resumed = new Promise<void>((resolve) => {
    resumeHash = resolve
  })
  const originalHash = auth.hashPassword
  vi.spyOn(auth, "hashPassword").mockImplementationOnce(async (password) => {
    announceHash()
    await resumed
    return originalHash(password)
  })
  const pending = resetPassword(request({}, false), {
    params: Promise.resolve({ id: user }),
  })
  try {
    await hashing
    await db
      .update(s.users)
      .set({ tokenVersion: sql`${s.users.tokenVersion} + 1` })
      .where(eq(s.users.id, user))
    const intermediateToken = await signToken({
      userId: user,
      role: "ADMIN",
      tokenVersion: 1,
    })
    setBearer(intermediateToken)
    expect((await getMe()).status).toBe(200)
    resumeHash()
    expect((await pending).status).toBe(200)
    // 必须排除强制改密的影响：旧令牌连改密流程也不能进入。
    expect(await getSessionUser({ allowPasswordChange: true })).toBeNull()
    const [updated] = await db
      .select({ version: s.users.tokenVersion })
      .from(s.users)
      .where(eq(s.users.id, user))
    expect(updated.version).toBe(2)
  } finally {
    resumeHash()
    await pending
  }
})

test("刷新令牌可换取新访问令牌，且旧令牌立即失效（轮换）", async () => {
  const user = await account("SUPERVISED")
  const first = await nativeLogin(user)

  const rotated = await refresh(
    request({ refreshToken: first.refreshToken }, true),
  )
  expect(rotated.status).toBe(200)
  const next = (await rotated.json()).data
  expect(next.refreshToken).not.toBe(first.refreshToken)
  expect(next.id).toBe(user)
  // 访问令牌是确定性 JWT（载荷只有 sub/tokenVersion/role/iat/exp），同一秒内
  // 重新签发会得到完全相同的字符串 —— 所以这里断言"新令牌可用"，而不是断言它不同。
  setBearer(next.token)
  expect((await getMe()).status).toBe(200)

  // 旧令牌已随轮换作废，重放必须失败
  expect(
    (await refresh(request({ refreshToken: first.refreshToken }, true))).status,
  ).toBe(401)
  // 新令牌可用
  expect(
    (await refresh(request({ refreshToken: next.refreshToken }, true))).status,
  ).toBe(200)
})

test("刷新接口拒绝非原生客户端，且不消耗令牌", async () => {
  const user = await account("SUPERVISED")
  const first = await nativeLogin(user)

  expect(
    (await refresh(request({ refreshToken: first.refreshToken }, false)))
      .status,
  ).toBe(403)
  // 被拒绝的那次不能把令牌作废
  expect(
    (await refresh(request({ refreshToken: first.refreshToken }, true))).status,
  ).toBe(200)
})

test("登出后刷新令牌立即失效，不必等它过期", async () => {
  const user = await account("SUPERVISED")
  const session = await nativeLogin(user)
  setBearer(session.token!)

  expect((await logout()).status).toBe(200)
  // 登出会把 tokenVersion +1；刷新令牌绑定在该版本上，因此立即失效
  expect(
    (await refresh(request({ refreshToken: session.refreshToken }, true)))
      .status,
  ).toBe(401)
})

test("登出撤销失败时返回错误并清除 Cookie，不谎报旧会话已失效", async () => {
  const user = await account("SUPERVISED")
  const session = await nativeLogin(user)
  setBearer(session.token!)
  const errorLog = vi.spyOn(console, "error").mockImplementation(() => {})
  const update = vi.spyOn(db, "update").mockImplementationOnce(() => {
    throw new Error("simulated revocation failure")
  })
  const transaction = vi
    .spyOn(db, "transaction")
    .mockRejectedValueOnce(new Error("simulated revocation failure"))
  const response = await logout()
  expect(response.status).toBe(500)
  expect((await response.json()).success).toBe(false)
  expect(response.cookies.get(AUTH_COOKIE_NAME)?.value).toBe("")
  expect(errorLog).toHaveBeenCalled()
  transaction.mockRestore()
  update.mockRestore()
  // 没有成功撤销，客户端必须知道旧令牌仍能访问。
  expect((await getMe()).status).toBe(200)
})

test("启用 MFA 后，原生客户端用响应体里的挑战令牌继续二次验证", async () => {
  const user = await account("SUPERVISED")
  await db.insert(s.mfaFactors).values({
    userId: user,
    secretEncrypted: encryptMfaSecret("JBSWY3DPEHPK3PXP"),
    lastUsedStep: -1,
    enabled: true,
    verifiedAt: new Date(),
  })

  const body = await nativeLogin(user)
  expect(body.requiresMfa).toBe(true)
  expect(typeof body.mfaToken).toBe("string")

  // 既没有 cookie 也没带挑战令牌 → 判为挑战过期
  const missing = await verifyMfa(
    request({ code: "000000", trustDevice: false }, true),
  )
  expect(missing.status).toBe(401)

  // 带上响应体里的挑战令牌 → 挑战本身有效，只是验证码不对（400 而非 401）
  const wrongCode = await verifyMfa(
    request(
      { code: "000000", trustDevice: false, mfaToken: body.mfaToken },
      true,
    ),
  )
  expect(wrongCode.status).toBe(400)
})
