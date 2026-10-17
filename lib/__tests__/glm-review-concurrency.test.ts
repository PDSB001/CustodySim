import { afterEach, expect, test, vi } from "vitest"

const mocks = vi.hoisted(() => ({ connect: vi.fn() }))
vi.mock("@/lib/db", () => ({ dbPool: { connect: mocks.connect } }))
import {
  acquireGlmReviewConcurrencySlot,
  getGlmReviewConcurrencyStatus,
} from "@/lib/glm-review-concurrency"

afterEach(() => {
  vi.unstubAllEnvs()
  vi.clearAllMocks()
})

test("all models share a bounded connection budget and release is idempotent", async () => {
  vi.stubEnv("GLM_REVIEW_MAX_CONCURRENCY", "50")
  vi.stubEnv("DATABASE_POOL_MAX", "20")
  const query = vi.fn(async () => ({ rows: [{ acquired: true }] }))
  const release = vi.fn()
  mocks.connect.mockImplementation(async () => ({ query, release }))
  for (let round = 0; round < 2; round++) {
    const slots = await Promise.all(
      Array.from({ length: 12 }, (_, i) =>
        acquireGlmReviewConcurrencySlot({
          provider: "test",
          model: `model-${i}`,
        }),
      ),
    )
    const acquired = slots.filter((slot) => slot !== null)
    expect(acquired).toHaveLength(5)
    await Promise.all(
      acquired.map(async (slot) => {
        await slot()
        await slot()
      }),
    )
  }
  expect(mocks.connect).toHaveBeenCalledTimes(10)
  expect(release).toHaveBeenCalledTimes(10)
})

test("failed connection acquisition releases the local reservation", async () => {
  vi.stubEnv("DATABASE_POOL_MAX", "4")
  mocks.connect.mockRejectedValueOnce(new Error("offline"))
  await expect(
    acquireGlmReviewConcurrencySlot({ provider: "test", model: "unknown" }),
  ).rejects.toThrow("offline")
  mocks.connect.mockResolvedValueOnce({
    query: async () => ({ rows: [{ acquired: true }] }),
    release: vi.fn(),
  })
  const release = await acquireGlmReviewConcurrencySlot({
    provider: "test",
    model: "unknown",
  })
  expect(release).not.toBeNull()
  await release?.()
})

test("zero budget exposes a pause reason, logs once and never borrows a connection", async () => {
  vi.stubEnv("DATABASE_POOL_MAX", "3")
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
  try {
    const config = { provider: "test", model: "glm-4.5-flash" }
    expect(getGlmReviewConcurrencyStatus(config.model)).toMatchObject({
      concurrencyLimit: 0,
      pauseReason: expect.stringContaining("保持待审"),
    })
    expect(await acquireGlmReviewConcurrencySlot(config)).toBeNull()
    expect(await acquireGlmReviewConcurrencySlot(config)).toBeNull()
    expect(mocks.connect).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalledTimes(1)
    vi.stubEnv("DATABASE_POOL_MAX", "20")
    mocks.connect.mockResolvedValueOnce({
      query: async () => ({ rows: [{ acquired: true }] }),
      release: vi.fn(),
    })
    const release = await acquireGlmReviewConcurrencySlot(config)
    expect(getGlmReviewConcurrencyStatus(config.model).pauseReason).toBeNull()
    await release?.()
    vi.stubEnv("DATABASE_POOL_MAX", "3")
    await acquireGlmReviewConcurrencySlot(config)
    expect(warn).toHaveBeenCalledTimes(2)
  } finally {
    warn.mockRestore()
  }
})
