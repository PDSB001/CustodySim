import { expect, test } from "vitest"
import {
  passesProbation,
  probationPeriod,
  registrationEmailHash,
  RegistrationSchema,
} from "@/lib/registration-policy"
test("考察采用次日起七个完整上海自然日，跨月跨周不缩短", () => {
  const period = probationPeriod(new Date("2026-10-31T23:59:59+08:00"))
  expect(period.start.toISOString()).toBe("2026-10-31T16:00:00.000Z")
  expect(period.end.getTime() - period.start.getTime()).toBe(7 * 86400_000)
  expect(passesProbation(0)).toBe(false)
  expect(passesProbation(-1)).toBe(false)
  expect(passesProbation(1)).toBe(true)
})
test("邮箱摘要规范化且注册表单拒绝自行指定权限", () => {
  expect(registrationEmailHash("  Person@Example.com ")).toBe(
    registrationEmailHash("person@example.com"),
  )
  const input = {
    username: "sample",
    name: "示例",
    email: "sample@example.com",
    password: "Password123",
    confirmPassword: "Password123",
    acceptTrial: true,
  }
  expect(RegistrationSchema.safeParse(input).success).toBe(true)
  expect(
    RegistrationSchema.safeParse({ ...input, role: "ADMIN" }).success,
  ).toBe(false)
  expect(
    RegistrationSchema.safeParse({ ...input, acceptTrial: false }).success,
  ).toBe(false)
})
