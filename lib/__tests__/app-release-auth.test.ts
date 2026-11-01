import { expect, test, vi } from "vitest"
import { NextRequest } from "next/server"
const auth = vi.hoisted(() => ({ admin: vi.fn(), origin: vi.fn() }))
vi.mock("@/lib/admin-api", () => ({ getAdminUser: auth.admin }))
vi.mock("@/lib/request-origin", () => ({ isSameOriginMutation: auth.origin }))
vi.mock("@/lib/app-download", () => ({ appDownloadPath: () => "/unused" }))
vi.mock("@/lib/audit", () => ({ writeAuditLog: vi.fn() }))
vi.mock("@/lib/app-release-server", () => ({
  withAppReleaseLock: vi.fn(),
  AppReleaseConflictError: class extends Error {},
}))
import { GET, PUT } from "@/app/api/admin/app-release/route"
test("没有管理员身份或可信来源时拒绝上传，不读取请求体", async () => {
  auth.origin.mockReturnValue(false)
  expect(
    (
      await PUT(
        new NextRequest("https://example.test/api/admin/app-release", {
          method: "PUT",
        }),
      )
    ).status,
  ).toBe(403)
  auth.origin.mockReturnValue(true)
  auth.admin.mockResolvedValue(null)
  const denied = await GET()
  expect(denied.status).toBe(403)
  expect(denied.headers.get("cache-control")).toBe("private, no-store")
  expect(denied.headers.get("content-security-policy")).toContain(
    "default-src 'none'",
  )
  expect(
    (
      await PUT(
        new NextRequest("https://example.test/api/admin/app-release", {
          method: "PUT",
        }),
      )
    ).status,
  ).toBe(403)
  auth.admin.mockResolvedValue({ id: "admin" })
  expect(
    (
      await PUT(
        new NextRequest("https://example.test/api/admin/app-release", {
          method: "PUT",
          headers: { "x-apk-size": "999999999" },
        }),
      )
    ).status,
  ).toBe(413)
})

test("身份服务异常的响应也禁止缓存并带 API CSP", async () => {
  auth.admin.mockRejectedValueOnce(new Error("database unavailable"))
  const log = vi.spyOn(console, "error").mockImplementation(() => {})
  try {
    const response = await GET()
    expect(response.status).toBe(500)
    expect(response.headers.get("cache-control")).toBe("private, no-store")
    expect(response.headers.get("content-security-policy")).toContain(
      "default-src 'none'",
    )
  } finally {
    log.mockRestore()
  }
})
