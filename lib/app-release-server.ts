import { dbPool } from "@/lib/db"

const LOCK_KEY = "custodysim:app-release:publish"
export class AppReleaseConflictError extends Error {}

/** Session lock spans upload, atomic replacement, audit, and any rollback. */
export async function withAppReleaseLock<T>(publish: () => Promise<T>) {
  const client = await dbPool.connect()
  let locked = false
  let broken = false
  try {
    const result = await client.query(
      "select pg_try_advisory_lock(hashtextextended($1, 0)) as locked",
      [LOCK_KEY],
    )
    locked = result.rows[0]?.locked === true
    if (!locked)
      throw new AppReleaseConflictError(
        "另一位管理员正在发布，请稍后刷新安装包状态再试",
      )
    return await publish()
  } finally {
    if (locked) {
      try {
        await client.query(
          "select pg_advisory_unlock(hashtextextended($1, 0))",
          [LOCK_KEY],
        )
      } catch {
        broken = true
      }
    }
    client.release(broken)
  }
}
