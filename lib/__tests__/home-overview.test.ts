import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  select: vi.fn(),
  eq: vi.fn(),
  actor: vi.fn(),
  today: vi.fn(),
  ensureTasks: vi.fn(),
}))

vi.mock("@/lib/db", () => ({ db: { select: mocks.select } }))
vi.mock("drizzle-orm", async (original) => ({
  ...(await original<typeof import("drizzle-orm")>()),
  eq: mocks.eq,
}))
vi.mock("@/lib/checkin", () => ({ getTodayCheckinRecords: mocks.today }))
vi.mock("@/lib/task-engine", () => ({ ensureUserTasks: mocks.ensureTasks }))
vi.mock("@/lib/session", () => ({ getSessionUser: mocks.actor }))

import { GET } from "@/app/api/my/overview/route"
import {
  applications,
  noticeReads,
  notices,
  profileRecords,
  reportTasks,
} from "@/lib/db/schema"
import { getHomeOverview, summarizeHomeCheckins } from "@/lib/home-overview"
import type { SessionUser } from "@/lib/session"

const actor: SessionUser = {
  id: "session-owner",
  username: "self",
  name: "本人",
  role: "SUPERVISED",
  organizationId: null,
  mustChangePassword: false,
}

describe("本人首页概览", () => {
  const tableResults = new Map<unknown, unknown[]>()
  const queriedTables: unknown[] = []

  beforeEach(() => {
    vi.clearAllMocks()
    tableResults.clear()
    queriedTables.length = 0
    mocks.today.mockResolvedValue([])
    mocks.ensureTasks.mockResolvedValue(undefined)
    mocks.actor.mockResolvedValue(actor)
    mocks.select.mockImplementation(() => ({
      from(table: unknown) {
        queriedTables.push(table)
        const rows = tableResults.get(table) ?? []
        const query = {
          leftJoin: () => query,
          where: () => query,
          groupBy: () => Promise.resolve(rows),
          then: (resolve: (data: unknown[]) => unknown) =>
            Promise.resolve(rows).then(resolve),
        }
        return query
      },
    }))
  })

  it("requires a session before reading any overview data", async () => {
    mocks.actor.mockResolvedValue(null)
    expect((await GET()).status).toBe(401)
    expect(mocks.select).not.toHaveBeenCalled()
    expect(mocks.today).not.toHaveBeenCalled()
    expect(mocks.ensureTasks).not.toHaveBeenCalled()
  })

  it("counts returned work and real review statuses, always for the session owner", async () => {
    tableResults.set(reportTasks, [
      { status: "PENDING", total: 2 },
      { status: "RETURNED", total: 1 },
      { status: "SUBMITTED", total: 4 },
      { status: "EXPIRED", total: 50 },
    ])
    tableResults.set(applications, [
      { status: "PENDING_REVIEW", total: 5 },
      { status: "RETURNED", total: 2 },
      { status: "APPROVED", total: 20 },
    ])
    tableResults.set(profileRecords, [
      { status: "DRAFT", total: 1 },
      { status: "RETURNED", total: 2 },
      { status: "PENDING_REVIEW", total: 3 },
      { status: "LOCKED", total: 4 },
    ])
    // This is the database total, independent of the notice list's 50-item page limit.
    tableResults.set(notices, [{ total: 201 }])
    const now = new Date("2026-10-01T12:00:00Z")

    expect(await getHomeOverview(actor, now)).toEqual({
      checkins: { total: 0, completed: 0, pending: 0, missed: 0 },
      tasks: { pending: 3, review: 4 },
      applications: { review: 5, returned: 2 },
      profiles: { draft: 1, returned: 2, review: 3, locked: 4 },
      unreadNotices: 201,
    })
    expect(mocks.today).toHaveBeenCalledWith(actor.id, now)
    expect(mocks.ensureTasks).toHaveBeenCalledWith(actor.id, now)
    expect(mocks.eq).toHaveBeenCalledWith(reportTasks.supervisedId, actor.id)
    expect(mocks.eq).toHaveBeenCalledWith(applications.userId, actor.id)
    expect(mocks.eq).toHaveBeenCalledWith(profileRecords.userId, actor.id)
    expect(mocks.eq).toHaveBeenCalledWith(noticeReads.userId, actor.id)
    expect(mocks.eq).toHaveBeenCalledWith(notices.targetRole, actor.role)
  })

  it.each(["ADMIN", "SUPERVISOR"] as const)(
    "returns only the reader's notice count for %s, without generating or reading supervised work",
    async (role) => {
      tableResults.set(notices, [{ total: 3 }])
      expect(await getHomeOverview({ ...actor, role })).toEqual({
        checkins: null,
        tasks: null,
        applications: null,
        profiles: null,
        unreadNotices: 3,
      })
      expect(queriedTables).toEqual([notices])
      expect(mocks.today).not.toHaveBeenCalled()
      expect(mocks.ensureTasks).not.toHaveBeenCalled()
      expect(mocks.eq).toHaveBeenCalledWith(noticeReads.userId, actor.id)
      expect(mocks.eq).toHaveBeenCalledWith(notices.targetRole, role)
    },
  )
})

describe("今日点名概览", () => {
  it("keeps completed and upcoming slots separate from missed slots and makeup reviews", () => {
    expect(
      summarizeHomeCheckins([
        { status: "PENDING" },
        { status: "PENDING" },
        { status: "COMPLETED" },
        { status: "LATE" },
        { status: "MAKEUP_APPROVED" },
        { status: "SYSTEM_MAKEUP" },
        { status: "MISSED" },
        { status: "MAKEUP_REJECTED", recordId: null },
        { status: "MAKEUP_PENDING", recordId: null },
      ]),
    ).toEqual({ total: 9, completed: 4, pending: 2, missed: 2 })
  })

  it("does not turn a late checkin into a missed slot when its makeup request is reviewed or rejected", () => {
    expect(
      summarizeHomeCheckins([
        { status: "MAKEUP_PENDING", recordId: "one", recordStatus: "LATE" },
        { status: "MAKEUP_REJECTED", recordId: "two", recordStatus: "LATE" },
      ]),
    ).toEqual({ total: 2, completed: 2, pending: 0, missed: 0 })
  })
})
