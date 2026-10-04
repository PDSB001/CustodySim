import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const mocks = vi.hoisted(() => ({
  actor: vi.fn(),
  task: vi.fn(),
  reading: vi.fn(),
  transaction: vi.fn(),
}))
vi.mock("@/lib/session", () => ({ getSessionUser: mocks.actor }))
vi.mock("@/lib/reading-server", () => ({ taskReadingSeconds: mocks.reading }))
vi.mock("@/lib/db", () => ({
  db: {
    select: () => ({ from: () => ({ where: () => ({ limit: mocks.task }) }) }),
    transaction: mocks.transaction,
  },
}))

import { POST } from "@/app/api/submissions/route"

const userId = "00000000-0000-4000-8000-000000000001"
const taskId = "00000000-0000-4000-8000-000000000002"
function request() {
  return new NextRequest("http://localhost/api/submissions", {
    method: "POST",
    body: JSON.stringify({ taskId, data: { 心得: "阅读心得" } }),
    headers: { "Content-Type": "application/json" },
  })
}
const task = () => ({
  id: taskId,
  supervisedId: userId,
  scheduleAt: new Date(Date.now() - 3600000),
  deadline: new Date(Date.now() + 3600000),
  status: "PENDING",
  templateSnapshot: {
    kind: "STUDY",
    readingMinutes: 30,
    fields: [{ name: "心得", type: "TEXTAREA", required: true, options: [] }],
  },
})

beforeEach(() => {
  vi.clearAllMocks()
  mocks.actor.mockResolvedValue({ id: userId, role: "SUPERVISED" })
  mocks.task.mockResolvedValue([task()])
  mocks.transaction.mockResolvedValue({ id: "submission" })
})

describe("study reading submission requirement", () => {
  it("does not accept manual submissions for automatic reading tasks", async () => {
    const automatic = task()
    mocks.task.mockResolvedValue([
      {
        ...automatic,
        templateSnapshot: {
          ...automatic.templateSnapshot,
          completionMode: "READING",
          fields: [],
        },
      },
    ])
    expect((await POST(request())).status).toBe(400)
    expect(mocks.reading).not.toHaveBeenCalled()
    expect(mocks.transaction).not.toHaveBeenCalled()
  })
  it("blocks submission at 29 minutes 59 seconds even with a valid form", async () => {
    mocks.reading.mockResolvedValue(1799)
    const response = await POST(request())
    expect(response.status).toBe(400)
    expect((await response.json()).error.message).toContain("29 / 30")
    expect(mocks.transaction).not.toHaveBeenCalled()
    expect(mocks.reading).toHaveBeenCalledWith(
      userId,
      expect.any(Date),
      expect.any(Date),
    )
  })
  it("allows submission at exactly the required duration", async () => {
    mocks.reading.mockResolvedValue(1800)
    expect((await POST(request())).status).toBe(201)
    expect(mocks.transaction).toHaveBeenCalledOnce()
  })
  it("keeps historical tasks without a reading requirement submittable", async () => {
    const existing = task()
    existing.templateSnapshot.readingMinutes = 0
    mocks.task.mockResolvedValue([existing])
    expect((await POST(request())).status).toBe(201)
    expect(mocks.reading).not.toHaveBeenCalled()
  })
  it("rejects a different account before querying reading records", async () => {
    mocks.actor.mockResolvedValue({ id: taskId, role: "SUPERVISED" })
    expect((await POST(request())).status).toBe(403)
    expect(mocks.reading).not.toHaveBeenCalled()
    expect(mocks.transaction).not.toHaveBeenCalled()
  })
})
