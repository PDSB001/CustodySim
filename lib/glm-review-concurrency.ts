import { createHash } from "node:crypto"
import { dbPool } from "@/lib/db"

const modelConcurrencyLimits: Record<string, number> = {
  "glm-4.1v-thinking-flash": 5,
  "glm-4.5-flash": 2,
  "glm-4.7-flash": 1,
}

export function getGlmReviewConcurrencyLimit(
  model: string,
  env: Record<string, string | undefined> = process.env,
) {
  const configured = Number(env.GLM_REVIEW_MAX_CONCURRENCY)
  if (Number.isSafeInteger(configured) && configured >= 1 && configured <= 50)
    return configured
  return modelConcurrencyLimits[model] ?? 1
}

/**
 * Holds a PostgreSQL session advisory lock while a model request is in flight,
 * so overlapping sweeps across app processes share the same concurrency limit.
 */
export async function acquireGlmReviewConcurrencySlot(config: {
  provider: string
  model: string
}): Promise<(() => Promise<void>) | null> {
  const limit = getGlmReviewConcurrencyLimit(config.model)
  const namespace = createHash("sha256")
    .update(`${config.provider}:${config.model}`)
    .digest()
    .readInt32BE(0)
  const client = await dbPool.connect()
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
    client.release(true)
    throw error
  }

  if (acquiredSlot === null) {
    client.release()
    return null
  }

  return async () => {
    try {
      await client.query(
        "SELECT pg_advisory_unlock($1::integer, $2::integer)",
        [namespace, acquiredSlot],
      )
      client.release()
    } catch {
      // Destroying the session guarantees PostgreSQL releases its advisory lock.
      client.release(true)
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
