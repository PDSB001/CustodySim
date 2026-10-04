import { beforeEach, describe, expect, it, vi } from "vitest"
const mocks = vi.hoisted(() => ({ score: vi.fn() }))
vi.mock("@/lib/scoring", () => ({
  recordScoreEvent: mocks.score,
  SCORE_POLICY: { taskFirstPass: 2, taskReturnedThenPass: 1 },
  getTaskOutcomeWeekKey: () => "2026-09-28",
}))
import { settleReadingTasks, settleReadingPoints } from "@/lib/reading-server"
type Executor = Parameters<typeof settleReadingTasks>[0]

beforeEach(() => {
  vi.clearAllMocks()
})

describe("automatic study settlement", () => {
  function fixture(seconds: number) {
    const task = {
      id: "task",
      supervisedId: "user",
      status: "PENDING",
      scheduleAt: new Date("2026-10-04T00:00:00Z"),
      deadline: new Date("2026-10-04T02:00:00Z"),
      templateSnapshot: { readingMinutes: 15, completionMode: "READING" },
    }
    const select = vi.fn((fields?: unknown) => ({
      from: () => ({
        where: () =>
          fields
            ? Promise.resolve([{ seconds }])
            : {
                orderBy: () => ({
                  for: () =>
                    Promise.resolve(
                      task.status === "PENDING" ? [{ ...task }] : [],
                    ),
                }),
              },
      }),
    }))
    const update = vi.fn(() => ({
      set: (value: { status: string }) => ({
        where: async () => {
          task.status = value.status
        },
      }),
    }))
    return { task, tx: { select, update } as unknown as Executor, update }
  }
  it("does not approve before 15 minutes", async () => {
    const state = fixture(899)
    expect(await settleReadingTasks(state.tx, "user")).toBe(0)
    expect(state.update).not.toHaveBeenCalled()
    expect(mocks.score).not.toHaveBeenCalled()
  })
  it("approves at exactly 15 minutes without a submission and only scores once", async () => {
    const state = fixture(900)
    expect(await settleReadingTasks(state.tx, "user")).toBe(1)
    expect(state.task.status).toBe("APPROVED")
    expect(mocks.score).toHaveBeenCalledWith(
      expect.objectContaining({
        points: 2,
        source: "TASK_OUTCOME",
        sourceId: "task",
      }),
    )
    expect(await settleReadingTasks(state.tx, "user")).toBe(0)
    expect(mocks.score).toHaveBeenCalledOnce()
  })
})

describe("reading score settlement", () => {
  function executor(seconds: number, awarded: number, enabled = true) {
    const rows = [
      [{ enabled, minutesPerPoint: 15, dailyCap: 3 }],
      [{ seconds }],
      [{ points: awarded }],
    ]
    return {
      select: () => ({
        from: () => ({ where: () => Promise.resolve(rows.shift()) }),
      }),
    } as unknown as Executor
  }
  it("awards only the missing delta and stops at the daily cap", async () => {
    const now = new Date("2026-10-04T09:00:00Z")
    expect(
      await settleReadingPoints(executor(1800, 1), "user", "tick1", now),
    ).toBe(1)
    expect(mocks.score).toHaveBeenCalledWith(
      expect.objectContaining({
        points: 1,
        source: "READING_DURATION",
        sourceId: "tick1",
      }),
    )
    mocks.score.mockClear()
    expect(
      await settleReadingPoints(executor(86400, 3), "user", "tick2", now),
    ).toBe(0)
    expect(mocks.score).not.toHaveBeenCalled()
  })
  it("does not grant points when disabled", async () => {
    expect(
      await settleReadingPoints(
        executor(900, 0, false),
        "user",
        "tick",
        new Date(),
      ),
    ).toBe(0)
    expect(mocks.score).not.toHaveBeenCalled()
  })
})
