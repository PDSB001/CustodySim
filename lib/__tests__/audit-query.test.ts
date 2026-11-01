import { expect, test } from "vitest"
import {
  AuditQuerySchema,
  auditLikePattern,
  parseAuditCursor,
  redactAuditDetail,
} from "@/lib/audit-query"
test("筛选验证日期边界、参数长度和真实日历日期", () => {
  expect(
    AuditQuerySchema.safeParse({ from: "2026-11-01", to: "2026-10-31" })
      .success,
  ).toBe(false)
  for (const from of ["2026-02-30", "2026-99-99", "garbage"])
    expect(AuditQuerySchema.safeParse({ from }).success).toBe(false)
  expect(AuditQuerySchema.safeParse({ q: "x".repeat(121) }).success).toBe(false)
  expect(AuditQuerySchema.safeParse({ actorType: "admin" }).success).toBe(false)
  expect(
    AuditQuerySchema.safeParse({ from: "2026-11-01", to: "2026-11-01" })
      .success,
  ).toBe(true)
})
test("游标保留微秒，拒绝伪造格式；关键词中的通配符作为普通文字", () => {
  const id = "a7a501ad-458e-4d31-bbdb-ce21e90396f2"
  expect(parseAuditCursor(`2026-11-01T00:00:00.123456Z|${id}`)?.time).toBe(
    "2026-11-01T00:00:00.123456Z",
  )
  expect(() => parseAuditCursor(`bad|${id}`)).toThrow()
  expect(auditLikePattern("50%_\\")).toBe("%50\\%\\_\\\\%")
})
test("详情递归隐藏敏感凭据，并保留业务前后值与原始对象", () => {
  const original = {
    before: { points: -144, passwordHash: "test-hash" },
    after: { points: -96 },
    items: [{ refreshToken: "test-token", taskId: "id" }],
  }
  const redacted = redactAuditDetail(original)
  expect(JSON.stringify(redacted)).not.toContain("test-token")
  expect(JSON.stringify(redacted)).not.toContain("test-hash")
  expect(original.before.passwordHash).toBe("test-hash")
  expect(redacted).toMatchObject({
    before: { points: -144 },
    after: { points: -96 },
  })
})
