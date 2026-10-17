import { and, count, eq, inArray, sql } from "drizzle-orm"
import { db } from "@/lib/db"
import { users } from "@/lib/db/schema"

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

export class AdminMembershipError extends Error {
  constructor(
    message: string,
    public readonly status: 400 | 403,
  ) {
    super(message)
  }
}

/** Serialize administrator removals and recheck the caller after waiting for the lock. */
export async function guardAdminRemoval(
  tx: Tx,
  actorId: string,
  targetId: string,
) {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtext('custodysim:admin-membership'))`,
  )
  const accounts = await tx
    .select({ id: users.id, role: users.role, status: users.status })
    .from(users)
    .where(inArray(users.id, [...new Set([actorId, targetId])]))
  const actor = accounts.find((account) => account.id === actorId)
  if (actor?.role !== "ADMIN" || actor.status !== "active")
    throw new AdminMembershipError("当前管理员账号已失效，请重新登录", 403)
  const target = accounts.find((account) => account.id === targetId)
  if (target?.role !== "ADMIN" || target.status !== "active") return
  const [row] = await tx
    .select({ total: count() })
    .from(users)
    .where(and(eq(users.role, "ADMIN"), eq(users.status, "active")))
  if ((row?.total ?? 0) <= 1)
    throw new AdminMembershipError("不能删除或停用最后一名有效管理员", 400)
}
