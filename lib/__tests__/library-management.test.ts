import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  ReadingRuleCreate,
  nextReadingRuleStart,
} from "@/lib/library-task-config"
const mocks = vi.hoisted(() => ({
  actor: vi.fn(),
  select: vi.fn(),
  transaction: vi.fn(),
  audit: vi.fn(),
}))
vi.mock("@/lib/admin-api", () => ({ getAdminUser: mocks.actor }))
vi.mock("@/lib/audit", () => ({ writeAuditLog: mocks.audit }))
vi.mock("@/lib/db", () => ({
  db: { select: mocks.select, transaction: mocks.transaction },
}))
import { POST } from "@/app/api/admin/library/tasks/route"
import { PUT, DELETE } from "@/app/api/admin/library/[id]/route"
import { ruleScopes } from "@/lib/db/schema"
const ids = [
  "00000000-0000-4000-8000-000000000001",
  "00000000-0000-4000-8000-000000000002",
]
const input = {
  name: "每日阅读",
  readingMinutes: 30,
  timeSlot: "09:00",
  timeoutMinutes: 120,
}
const request = () =>
  new Request("http://localhost/api/admin/library/tasks", {
    method: "POST",
    body: JSON.stringify(input),
  })
beforeEach(() => {
  vi.clearAllMocks()
  mocks.actor.mockResolvedValue({ id: ids[0], role: "ADMIN", name: "管理员" })
})
describe("library management and task targeting", () => {
  it("rejects non-admin writes before reading uploads or touching the database", async () => {
    mocks.actor.mockResolvedValue(null)
    expect((await POST(request())).status).toBe(403)
    const context = { params: Promise.resolve({ id: ids[0] }) }
    expect((await PUT(request(), context)).status).toBe(403)
    expect((await DELETE(request(), context)).status).toBe(403)
    expect(mocks.select).not.toHaveBeenCalled()
    expect(mocks.transaction).not.toHaveBeenCalled()
  })
  it("creates explicit scopes for all current supervised users rather than an ineffective empty scope", async () => {
    mocks.select.mockReturnValue({
      from: () => ({ where: async () => ids.map((id) => ({ id })) }),
    })
    const insert = vi.fn((table) => ({
      values: (value: unknown) => ({
        returning: async () =>
          table === ruleScopes ? value : [{ id: "rule" }],
      }),
    }))
    mocks.transaction.mockImplementation(async (callback) =>
      callback({ insert }),
    )
    expect((await POST(request())).status).toBe(201)
    expect(insert).toHaveBeenCalledWith(ruleScopes)
    const body = await (await POST(request())).json()
    expect(
      body.data.scopes.map((scope: { targetId: string }) => scope.targetId),
    ).toEqual(ids)
    expect(
      body.data.scopes.every(
        (scope: { targetType: string }) => scope.targetType === "USER",
      ),
    ).toBe(true)
  })
  it("refuses creating an unassigned rule when there are no supervised users", async () => {
    mocks.select.mockReturnValue({ from: () => ({ where: async () => [] }) })
    expect((await POST(request())).status).toBe(400)
    expect(mocks.transaction).not.toHaveBeenCalled()
  })
  it("validates reading time and target exclusivity", () => {
    expect(
      ReadingRuleCreate.safeParse({ ...input, readingMinutes: 121 }).success,
    ).toBe(false)
    expect(
      ReadingRuleCreate.safeParse({ ...input, userId: ids[0], groupId: ids[1] })
        .success,
    ).toBe(false)
  })
  it("starts a past daily slot tomorrow in Shanghai instead of backdating an expired task", () => {
    expect(
      nextReadingRuleStart(
        "09:00",
        new Date("2026-10-04T02:00:00Z"),
      ).toISOString(),
    ).toBe("2026-10-04T16:00:00.000Z")
    expect(
      nextReadingRuleStart(
        "12:00",
        new Date("2026-10-04T02:00:00Z"),
      ).toISOString(),
    ).toBe("2026-10-03T16:00:00.000Z")
  })
})
