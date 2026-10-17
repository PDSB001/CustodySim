import { createHash } from "node:crypto"
import { dbPool } from "@/lib/db"

const modelConcurrencyLimits: Record<string, number> = {
  "glm-4.1v-thinking-flash": 5,
  "glm-4.5-flash": 2,
  "glm-4.7-flash": 1,
}

function connectionBudget(env: Record<string, string | undefined>) {
  const poolMax = Number(env.DATABASE_POOL_MAX) || 20
  // All models together may pin at most a quarter of the pool, capped at five.
  return Math.max(0, Math.min(5, Math.floor(poolMax / 4)))
}

const slotStateKey = Symbol.for("custodysim.glm-pinned-connections")
const runtime = globalThis as typeof globalThis & {
  [slotStateKey]?: { active: number; pauseReason?: string | null }
}
const slotState = (runtime[slotStateKey] ??= { active: 0 })

export function getGlmReviewConcurrencyLimit(
  model: string,
  env: Record<string, string | undefined> = process.env,
) {
  const configured = Number(env.GLM_REVIEW_MAX_CONCURRENCY)
  if (Number.isSafeInteger(configured) && configured >= 1 && configured <= 50)
    return Math.min(configured, connectionBudget(env))
  return Math.min(modelConcurrencyLimits[model] ?? 1, connectionBudget(env))
}

export function getGlmReviewConcurrencyStatus(
  model: string,
  env: Record<string, string | undefined> = process.env,
) {
  const concurrencyLimit = getGlmReviewConcurrencyLimit(model, env)
  return {
    concurrencyLimit,
    pauseReason:
      concurrencyLimit === 0
        ? "数据库连接预算不足，模型自动审核已暂停。请检查 DATABASE_POOL_MAX 配置；待审记录保持待审，仍可人工审核。"
        : null,
  }
}

/**
 * Holds a PostgreSQL session advisory lock while a model request is in flight,
 * so overlapping sweeps across app processes share the same concurrency limit.
 */
export async function acquireGlmReviewConcurrencySlot(config: {
  provider: string
  model: string
}): Promise<(() => Promise<void>) | null> {
  const { concurrencyLimit: limit, pauseReason } =
    getGlmReviewConcurrencyStatus(config.model)
  if (!limit) {
    if (slotState.pauseReason !== pauseReason)
      console.warn("[auto-review] model reviews paused:", pauseReason)
    slotState.pauseReason = pauseReason
    return null
  }
  slotState.pauseReason = null
  if (slotState.active >= connectionBudget(process.env)) return null
  slotState.active += 1
  const namespace = createHash("sha256")
    .update(`${config.provider}:${config.model}`)
    .digest()
    .readInt32BE(0)
  const client = await dbPool.connect().catch((error: unknown) => {
    slotState.active -= 1
    throw error
  })
  let acquiredSlot: number | null = null

  try {
    for (let slot = 0; slot < limit; slot += 1) {
      const result = await client.query<{ acquired: boolean }>(
        "SELECT pg_try_advisory_lock($1::integer, $2::integer) AS acquired",
        [namespace, slot],
      )
      if (result.rows[0]?.acquired) {
        acquiredSlot = slot
        break
      }
    }
  } catch (error) {
    slotState.active -= 1
    client.release(true)
    throw error
  }

  if (acquiredSlot === null) {
    slotState.active -= 1
    client.release()
    return null
  }

  let released = false
  return async () => {
    if (released) return
    released = true
    try {
      await client.query(
        "SELECT pg_advisory_unlock($1::integer, $2::integer)",
        [namespace, acquiredSlot],
      )
      client.release()
    } catch {
      // Destroying the session guarantees PostgreSQL releases its advisory lock.
      client.release(true)
    } finally {
      slotState.active -= 1
    }
  }
}

export async function withGlmReviewConcurrency<T>(
  config: { provider: string; model: string },
  operation: () => Promise<T>,
): Promise<T | null> {
  const release = await acquireGlmReviewConcurrencySlot(config)
  if (!release) return null
  try {
    return await operation()
  } finally {
    await release()
  }
}
