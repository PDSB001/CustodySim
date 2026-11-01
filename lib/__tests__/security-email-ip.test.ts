import { expect, test, vi } from "vitest"
const service = vi.hoisted(() => ({ send: vi.fn(), confirm: vi.fn() }))
vi.mock("@/lib/session", () => ({
  getSessionUser: async () => ({ id: "account" }),
}))
vi.mock("@/lib/admin-api", () => ({ getRequestIp: () => null }))
vi.mock("@/lib/security-mail-server", () => ({
  beginEmailBinding: service.send,
  confirmEmailBinding: service.confirm,
  EmailSecurityError: class extends Error {},
}))
import { POST as send } from "@/app/api/auth/security-email/send/route"
import { POST as confirm } from "@/app/api/auth/security-email/confirm/route"

test("缺少可信 IP 时不再向邮件服务传入共享 unknown 标识", async () => {
  const request = (body: unknown) =>
    new Request("https://example.test", {
      method: "POST",
      body: JSON.stringify(body),
    })
  service.send.mockResolvedValue({ sent: true })
  await send(request({ email: "user@example.com", password: "Password123" }))
  expect(service.send.mock.calls[0][2]).toBeNull()
  await confirm(
    request({
      challengeId: "11111111-1111-4111-8111-111111111111",
      code: "123456",
    }),
  )
  expect(service.confirm.mock.calls[0][3]).toBeNull()
})
