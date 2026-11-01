import pg from "pg"

// Preview by default. Only repair unrecorded preset overlaps in an unarchived week.
const args = process.argv.slice(2)
const day = args.find((arg) => arg.startsWith("--day="))?.slice(6)
const apply = args.includes("--apply")
const confirmed = args
  .find((arg) => arg.startsWith("--confirm-database="))
  ?.slice(19)
if (!/^\d{4}-\d{2}-\d{2}$/.test(day ?? "") || day >= "2026-11-01")
  throw new Error(
    "Specify a legacy business day before 2026-11-01 with --day=YYYY-MM-DD",
  )
const start = new Date(`${day}T00:00:00+08:00`)
if (
  !Number.isFinite(start.getTime()) ||
  start.toLocaleDateString("en-CA", { timeZone: "Asia/Shanghai" }) !== day
)
  throw new Error("Invalid day")
const end = new Date(start.getTime() + 86400_000)
const monday = new Date(`${day}T00:00:00Z`)
monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7))
const week = monday.toISOString().slice(0, 10)
const client = new pg.Client({ connectionString: process.env.DATABASE_URL })
await client.connect()
try {
  await client.query(apply ? "BEGIN" : "BEGIN READ ONLY")
  await client.query("SET LOCAL statement_timeout='30s'")
  const database = (await client.query("select current_database() name"))
    .rows[0].name
  if (
    apply &&
    (confirmed !== database ||
      (database !== "custodysim" && database !== "custodysim_e2e"))
  )
    throw new Error("Database confirmation mismatch")
  if (apply)
    await client.query(
      "select pg_advisory_xact_lock(hashtext('repair-checkin-plan-overlaps'))",
    )
  const candidates = (
    await client.query(
      `select t.id,t.supervised_id from checkin_tasks t
    join rules r on r.id=t.rule_id and r.custody_level is not null and r.custody_level<>'ISOLATION'
    where t.schedule_at >= $1 and t.schedule_at < $2 and t.status='MISSED'
      and not exists(select 1 from checkin_records cr where cr.task_id=t.id)
      and not exists(select 1 from checkin_makeups cm where cm.task_id=t.id)
      and exists(select 1 from checkin_tasks replacement join rules rr on rr.id=replacement.rule_id
        join isolation_orders io on io.supervised_id=t.supervised_id and io.start_at<=t.schedule_at and io.end_at>t.schedule_at
        where replacement.supervised_id=t.supervised_id and replacement.schedule_at >= $1 and replacement.schedule_at < $2
          and rr.custody_level='ISOLATION' and replacement.status='MISSED')`,
      [start, end],
    )
  ).rows
  const ids = candidates.map((row) => row.id)
  const people = [...new Set(candidates.map((row) => row.supervised_id))]
  if (!ids.length) {
    console.log(
      JSON.stringify({
        database,
        day,
        mode: apply ? "apply" : "preview",
        tasks: 0,
        changed: false,
      }),
    )
    await client.query("ROLLBACK")
    process.exitCode = 0
  } else {
    const archived = await client.query(
      "select 1 from score_week_reviews where supervised_id=any($1::uuid[]) and week_key=$2 limit 1",
      [people, week],
    )
    if (archived.rowCount)
      throw new Error(
        "Affected week is archived; requires a separate reviewed correction",
      )
    const daily = (
      await client.query(
        `select d.*,e.points event_points from checkin_daily_scores d join score_events e on e.id=d.score_event_id
      where d.supervised_id=any($1::uuid[]) and d.day_key=$2 ${apply ? "for update of d,e" : ""}`,
        [people, day],
      )
    ).rows
    if (
      daily.length !== people.length ||
      daily.some(
        (row) =>
          row.points !== row.event_points ||
          row.points !==
            row.completed_count - row.makeup_count - 2 * row.missing_count,
      )
    )
      throw new Error(
        "Daily/event snapshots do not match the expected legacy policy",
      )
    const summary = {
      database,
      day,
      week,
      mode: apply ? "apply" : "preview",
      tasks: ids.length,
      people: people.length,
      pointsBefore: daily.reduce((s, row) => s + row.points, 0),
      pointsAfter: daily.reduce((s, row) => s + row.points, 0) + ids.length * 2,
    }
    console.log(JSON.stringify(summary))
    if (!apply) await client.query("ROLLBACK")
    else {
      // A timestamped, retained backup schema is committed with the repair.
      const backup = `custodysim_backup_overlap_${new Date().toISOString().replace(/\D/g, "").slice(0, 17)}`
      await client.query(`create schema "${backup}"`)
      for (const [table, filter, values] of [
        ["checkin_tasks", "id=any($1::uuid[])", [ids]],
        [
          "checkin_daily_scores",
          "supervised_id=any($1::uuid[]) and day_key=$2",
          [people, day],
        ],
        [
          "score_events",
          "id=any($1::uuid[])",
          [daily.map((row) => row.score_event_id)],
        ],
      ]) {
        await client.query(
          `create table "${backup}".${table} as select * from ${table} with no data`,
        )
        await client.query(
          `insert into "${backup}".${table} select * from ${table} where ${filter}`,
          values,
        )
      }
      const updated = await client.query(
        "update checkin_tasks set status='SYSTEM_MAKEUP',updated_at=now() where id=any($1::uuid[]) and status='MISSED' returning id",
        [ids],
      )
      if (updated.rowCount !== ids.length)
        throw new Error("Task snapshot changed; rolling back")
      for (const row of daily) {
        const removed = candidates.filter(
          (task) => task.supervised_id === row.supervised_id,
        ).length
        if (row.missing_count < removed || row.scheduled_count < removed)
          throw new Error("Daily counts do not match candidates")
        const points = row.points + removed * 2
        await client.query(
          "update checkin_daily_scores set scheduled_count=scheduled_count-$1,missing_count=missing_count-$1,points=$2,settled_at=now(),updated_at=now() where id=$3",
          [removed, points, row.id],
        )
        const reason = `${day} 打卡日结：完成 ${row.completed_count} 次，补卡 ${row.makeup_count} 次，缺卡 ${row.missing_count - removed} 次`
        await client.query(
          "update score_events set points=$1,reason=$2 where id=$3",
          [points, reason, row.score_event_id],
        )
      }
      await client.query(
        `insert into audit_logs(actor_name,actor_role,actor_type,action,action_label,entity_type,detail) values ('系统维护','SYSTEM_AI','SYSTEM_AI','REPAIR','修正预设方案重复排班','checkin_tasks',$1::jsonb)`,
        [JSON.stringify({ ...summary, backup, taskIds: ids })],
      )
      await client.query("COMMIT")
      console.log(JSON.stringify({ applied: true, backup }))
    }
  }
} catch (error) {
  await client.query("ROLLBACK").catch(() => {})
  throw error
} finally {
  await client.end()
}
