import { createHash, randomUUID } from "node:crypto"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"
import pg from "pg"

function resetIdentity(day) {
  const hash = createHash("sha256")
    .update(`custodysim:leaderboard-reset:${day}:v1`)
    .digest("hex")
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`
}

/** Append a baseline adjustment; never delete or reprice historical score events. */
export async function resetCurrentLeaderboard(
  client,
  { day, apply = false, expectedDatabase, now = new Date() },
) {
  const today = now.toLocaleDateString("en-CA", { timeZone: "Asia/Shanghai" })
  if (day !== today || !/^\d{4}-\d{2}-\d{2}$/.test(day))
    throw new Error("Reset day must be the current Shanghai business day")
  const monday = new Date(`${day}T00:00:00Z`)
  monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7))
  const week = monday.toISOString().slice(0, 10)
  const operationId = resetIdentity(day)
  await client.query(apply ? "BEGIN" : "BEGIN READ ONLY")
  try {
    await client.query("SET LOCAL lock_timeout='5s'")
    await client.query("SET LOCAL statement_timeout='30s'")
    const database = (await client.query("select current_database() name"))
      .rows[0].name
    if (
      apply &&
      (database !== expectedDatabase ||
        !["custodysim", "custodysim_e2e"].includes(database))
    )
      throw new Error("Database confirmation mismatch")
    if (apply) {
      await client.query(
        "select pg_advisory_xact_lock(hashtextextended($1,0))",
        [`leaderboard-reset:${day}`],
      )
      // Serialize briefly against score writers so every adjustment uses one exact cutoff.
      await client.query("LOCK TABLE score_events IN SHARE ROW EXCLUSIVE MODE")
    }
    const prior = (
      await client.query(
        "select detail from audit_logs where entity_type='score_reset' and entity_id=$1 and action='RESET' limit 1",
        [operationId],
      )
    ).rows[0]
    if (prior) {
      await client.query("ROLLBACK")
      return {
        day,
        week,
        alreadyApplied: true,
        changed: false,
        backupSchema: prior.detail.backupSchema,
      }
    }
    const plan = (
      await client.query(
        `
      select u.id supervised_id, coalesce(sum(e.points),0)::int before_score
      from users u left join score_events e on e.supervised_id=u.id and e.week_key=$1
      where u.role='SUPERVISED' and u.status='active' group by u.id order by u.id
    `,
        [week],
      )
    ).rows
    const totals = plan.map((row) => row.before_score)
    const summary = {
      day,
      week,
      people: plan.length,
      adjusted: plan.filter((row) => row.before_score !== 0).length,
      beforeTotal: totals.reduce((sum, value) => sum + value, 0),
      beforeMin: totals.length ? Math.min(...totals) : 0,
      beforeMax: totals.length ? Math.max(...totals) : 0,
    }
    if (!apply) {
      await client.query("ROLLBACK")
      return { ...summary, changed: false, mode: "preview" }
    }
    const backupSchema = `custodysim_backup_score_reset_${now.toISOString().replace(/\D/g, "")}_${randomUUID().slice(0, 8)}`
    if (!/^[a-z0-9_]+$/.test(backupSchema) || backupSchema.length > 63)
      throw new Error("Invalid backup schema")
    await client.query(`CREATE SCHEMA "${backupSchema}"`)
    const ids = plan.map((row) => row.supervised_id)
    await client.query(
      `CREATE TABLE "${backupSchema}".score_events AS SELECT * FROM score_events WHERE supervised_id=ANY($1::uuid[]) AND week_key=$2`,
      [ids, week],
    )
    await client.query(
      `CREATE TABLE "${backupSchema}".reset_summary (supervised_id uuid primary key, before_score integer not null, adjustment integer not null, reset_event_id uuid, cutoff_at timestamptz not null)`,
    )
    const cutoff = (await client.query("select clock_timestamp() cutoff"))
      .rows[0].cutoff
    for (const row of plan) {
      const resetEventId = row.before_score === 0 ? null : randomUUID()
      if (resetEventId)
        await client.query(
          `
        insert into score_events(id,supervised_id,points,reason,source,source_id,operator_id,week_key,created_at)
        values($1,$2,$3,$4,'SCORE_RESET',$1,null,$5,$6)
      `,
          [
            resetEventId,
            row.supervised_id,
            -row.before_score,
            `${day} 经服务提供者确认，当前周榜从本次重置时刻归零；此前流水保留`,
            week,
            cutoff,
          ],
        )
      await client.query(
        `INSERT INTO "${backupSchema}".reset_summary VALUES($1,$2,$3,$4,$5)`,
        [
          row.supervised_id,
          row.before_score,
          -row.before_score,
          resetEventId,
          cutoff,
        ],
      )
    }
    const remaining = (
      await client.query(
        `select supervised_id from score_events where supervised_id=ANY($1::uuid[]) and week_key=$2 group by supervised_id having sum(points)<>0`,
        [ids, week],
      )
    ).rowCount
    if (remaining) throw new Error("Post-reset score verification failed")
    await client.query(
      `
      insert into audit_logs(actor_id,actor_name,actor_role,actor_type,action,action_label,entity_type,entity_id,detail)
      values(null,'系统维护','SYSTEM_AI','SYSTEM_AI','RESET','重置当前周积分排行榜','score_reset',$1,$2::jsonb)
    `,
      [
        operationId,
        JSON.stringify({
          ...summary,
          afterTotal: 0,
          cutoffAt: cutoff,
          backupSchema,
          policy: "append baseline, retain original events",
          authorizedBy: "服务提供者在当前会话明确确认",
        }),
      ],
    )
    await client.query("COMMIT")
    return {
      ...summary,
      afterTotal: 0,
      cutoffAt: cutoff,
      backupSchema,
      changed: true,
    }
  } catch (error) {
    await client.query("ROLLBACK")
    throw error
  }
}

async function main() {
  const args = process.argv.slice(2)
  if (
    args.some(
      (arg) =>
        arg !== "--apply" &&
        !arg.startsWith("--day=") &&
        !arg.startsWith("--confirm-database="),
    )
  )
    throw new Error("Invalid arguments")
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required")
  const client = new pg.Client({
    connectionString: process.env.DATABASE_URL,
    connectionTimeoutMillis: 10000,
  })
  await client.connect()
  try {
    console.log(
      JSON.stringify(
        await resetCurrentLeaderboard(client, {
          day: args.find((arg) => arg.startsWith("--day="))?.slice(6),
          apply: args.includes("--apply"),
          expectedDatabase: args
            .find((arg) => arg.startsWith("--confirm-database="))
            ?.slice(19),
        }),
      ),
    )
  } finally {
    await client.end()
  }
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((error) => {
    console.error(error.message)
    process.exitCode = 1
  })
}
