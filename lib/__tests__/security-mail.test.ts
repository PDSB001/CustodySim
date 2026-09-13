import { beforeEach, afterEach, expect, test, vi } from "vitest"
import {
  getSecurityMailConfig,
  maskSecurityEmail,
  SecurityEmailSchema,
  sendSecurityMail,
} from "@/lib/security-mail"
import { hashEmailCode, matchTotpStep } from "@/lib/mfa"
import { verifyMfaChallenge } from "@/lib/auth"
import { SignJWT } from "jose"

const mocks = vi.hoisted(() => ({ send: vi.fn(), configs: vi.fn() }))
vi.mock("tencentcloud-sdk-nodejs-ses", () => ({
  ses: {
    v20201002: {
      Client: class {
        constructor(config: unknown) {
          mocks.configs(config)
        }
        SendEmail = mocks.send
      },
    },
  },
}))
beforeEach(() => {
  vi.stubEnv(
    "AUTH_SECRET",
    "test-auth-secret-with-more-than-thirty-two-characters",
  )
  vi.stubEnv("TENCENT_SES_SECRET_ID", "private-id")
  vi.stubEnv("TENCENT_SES_SECRET_KEY", "private-key")
  vi.stubEnv("TENCENT_SES_REGION", "ap-guangzhou")
  vi.stubEnv("TENCENT_SES_FROM", "sender@example.com")
  vi.stubEnv("TENCENT_SES_CODE_TEMPLATE_ID", "12")
  vi.stubEnv("TENCENT_SES_NOTICE_TEMPLATE_ID", "13")
  mocks.send.mockReset().mockResolvedValue({ MessageId: "test-message" })
  mocks.configs.mockReset()
})
afterEach(() => vi.unstubAllEnvs())

test("邮箱规范化不改变本地部分，拒绝邮件头注入和多收件人", () => {
  expect(SecurityEmailSchema.parse(" User@EXAMPLE.COM ")).toBe(
    "User@example.com",
  )
  expect(maskSecurityEmail("User@example.com")).toBe("U***@example.com")
  for (const email of [
    "a@example.com\r\nBcc: b@example.com",
    "a@example.com,b@example.com",
    "User <a@example.com>",
  ])
    expect(SecurityEmailSchema.safeParse(email).success).toBe(false)
})
test("使用官方 API 的已审核模板，只发送指定收件人与变量", async () => {
  await sendSecurityMail({
    to: "member@example.com",
    kind: "code",
    params: { code: "123456", minutes: "5" },
  })
  expect(mocks.send).toHaveBeenCalledWith(
    expect.objectContaining({
      Destination: ["member@example.com"],
      Template: {
        TemplateID: 12,
        TemplateData: '{"code":"123456","minutes":"5"}',
      },
    }),
  )
  expect(mocks.configs).toHaveBeenCalledWith(
    expect.objectContaining({
      profile: {
        httpProfile: { endpoint: "ses.tencentcloudapi.com", reqTimeout: 10 },
      },
    }),
  )
  await sendSecurityMail({
    to: "member@example.com",
    kind: "notice",
    params: { event: "已换绑", time: "2026-09-13" },
  })
  expect(mocks.send.mock.calls.at(-1)![0].Template.TemplateID).toBe(13)
})
test("缺少配置不发送，提供方错误不暴露凭据或验证码", async () => {
  vi.stubEnv("TENCENT_SES_SECRET_KEY", "")
  expect(getSecurityMailConfig().configured).toBe(false)
  await expect(
    sendSecurityMail({ to: "member@example.com", kind: "code", params: {} }),
  ).rejects.toThrow("尚未配置")
  expect(mocks.send).not.toHaveBeenCalled()
  vi.stubEnv("TENCENT_SES_SECRET_KEY", "private-key")
  mocks.send.mockRejectedValue(
    new Error("private-key 123456 member@example.com"),
  )
  await expect(
    sendSecurityMail({ to: "member@example.com", kind: "code", params: {} }),
  ).rejects.toThrow(/^邮件发送失败，请稍后重试$/)
})
test("验证码摘要绑定挑战，TOTP 返回可消费的时间步", () => {
  expect(hashEmailCode("a", "123456")).not.toBe(hashEmailCode("b", "123456"))
  expect(hashEmailCode("a", "123456")).toHaveLength(64)
  expect(
    matchTotpStep("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ", "287082", 59000),
  ).toBe(1)
})
test("没有一次性 ID 的旧 MFA 登录票据不可使用", async () => {
  const legacy = await new SignJWT({ purpose: "mfa-login", tokenVersion: 0 })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject("11111111-1111-4111-8111-111111111111")
    .setExpirationTime("5m")
    .sign(new TextEncoder().encode(process.env.AUTH_SECRET!))
  expect(await verifyMfaChallenge(legacy)).toBeNull()
})
