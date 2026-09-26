import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { resolve } from "node:path"
import { config } from "dotenv"
import pg from "pg"

export const performanceIndexes = [
  { name: "persons_created_id_idx", table: "persons", keys: "created_at, id" },
  {
    name: "chat_messages_conversation_cursor_idx",
    table: "chat_messages",
    keys: "conversation_id, created_at DESC, id DESC",
  },
  {
    name: "chat_messages_sender_created_idx",
    table: "chat_messages",
    keys: "sender_id, created_at",
  },
  // 每人打卡明细按 (checkinAt, id) 降序游标翻页（/api/supervision/checkins/records）。
  // 原有 checkin_records_user_created_idx 是 (user_id, created_at)，顺序对不上用不了。
  {
    name: "checkin_records_user_checkin_idx",
    table: "checkin_records",
    keys: "user_id, checkin_at DESC, id DESC",
  },
]

/**
 * 归一化索引定义后再比较。
 *
 * `pg_get_indexdef` 会保留显式的 NULLS 子句：drizzle-kit 的 `db:push` 生成的是
 * `... DESC NULLS LAST`，而本脚本的 SQL 写的是裸 `... DESC`（等价 `NULLS FIRST`）。
 * 这些索引列都是 NOT NULL，两种写法语义完全一致 —— 不归一化就会把同一个索引
 * 判成 conflict，把升级挡在预检那一步（线上和 e2e 库都会中招）。
 */
function normalizeIndexDefinition(value) {
  return value.replace(/\s+NULLS\s+(?:FIRST|LAST)/g, "").replace(/\s+ASC\b/g, "")
}

export async function inspectPerformanceIndexes(client) {
  const result = await client.query(
    `
    SELECT c.relname AS name, t.relname AS "table", i.indisvalid AS valid,
           i.indisready AS ready, pg_get_indexdef(c.oid) AS definition
    FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
    JOIN pg_class t ON t.oid = i.indrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = ANY($1::text[])
  `,
    [performanceIndexes.map((index) => index.name)],
  )
  return performanceIndexes.map((expected) => {
    const actual = result.rows.find((row) => row.name === expected.name)
    const expectedDefinition = normalizeIndexDefinition(
      ` USING btree (${expected.keys})`,
    )
    return {
      name: expected.name,
      status: !actual
        ? "missing"
        : actual.table !== expected.table ||
            !normalizeIndexDefinition(actual.definition).endsWith(expectedDefinition)
          ? "conflict"
          : !actual.valid || !actual.ready
            ? "invalid"
            : "ready",
    }
  })
}

export async function runPerformanceUpgrade(client, mode) {
  if (!["check", "apply", "rollback"].includes(mode))
    throw new Error("Unsupported mode")
  if (mode === "check") return inspectPerformanceIndexes(client)
  const lockKey = "custodysim:20260925:web-performance"
  const lock = await client.query(
    "SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS locked",
    [lockKey],
  )
  if (!lock.rows[0].locked)
    throw new Error("Another performance upgrade is running")
  try {
    const before = await inspectPerformanceIndexes(client)
    // Invalid concurrent builds require an explicit rollback first; never
    // silently skip an invalid index because its name already exists.
    if (
      before.some(
        (index) =>
          index.status === "conflict" ||
          (mode === "apply" && index.status === "invalid"),
      )
    ) {
      throw new Error(`Index preflight failed: ${JSON.stringify(before)}`)
    }
    const source = readFileSync(
      new URL(
        `../lib/db/upgrades/20260925-web-performance.${mode === "apply" ? "up" : "down"}.sql`,
        import.meta.url,
      ),
      "utf8",
    )
    await client.query("SET lock_timeout = '5s'")
    await client.query("SET statement_timeout = '30min'")
    // These fixed SQL files contain plain index statements only, no functions
    // or string literals containing semicolons. Do not wrap this in BEGIN.
    for (const statement of source
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)) {
      await client.query(statement)
    }
    const after = await inspectPerformanceIndexes(client)
    const expected = mode === "apply" ? "ready" : "missing"
    if (after.some((index) => index.status !== expected))
      throw new Error(`Index verification failed: ${JSON.stringify(after)}`)
    return after
  } finally {
    await client.query("SELECT pg_advisory_unlock(hashtextextended($1, 0))", [
      lockKey,
    ])
  }
}

async function main() {
  config({ path: ".env.local", quiet: true })
  const args = process.argv.slice(2)
  if (args.includes("--help")) {
    console.log(
      "node scripts/upgrade-web-performance.mjs [--check|--apply|--rollback] --database=<expected database name>\nDefault: read-only check. Reads DATABASE_URL from environment or .env.local.",
    )
    return
  }
  const modes = args.filter((arg) =>
    ["--check", "--apply", "--rollback"].includes(arg),
  )
  if (
    modes.length > 1 ||
    args.some((arg) => !modes.includes(arg) && !arg.startsWith("--database="))
  )
    throw new Error("Invalid arguments; use --help")
  const expectedDatabase = args
    .find((arg) => arg.startsWith("--database="))
    ?.slice("--database=".length)
  if (!expectedDatabase || !process.env.DATABASE_URL)
    throw new Error("DATABASE_URL and --database=<expected name> are required")
  const mode = modes[0]?.slice(2) ?? "check"
  const client = new pg.Client({
    connectionString: process.env.DATABASE_URL,
    connectionTimeoutMillis: 10_000,
    application_name: "custodysim-web-performance-upgrade",
  })
  await client.connect()
  try {
    const { rows } = await client.query("SELECT current_database() AS name")
    if (rows[0].name !== expectedDatabase)
      throw new Error(
        "Connected database does not match --database; no changes applied",
      )
    console.log(
      JSON.stringify(
        {
          database: rows[0].name,
          mode,
          indexes: await runPerformanceUpgrade(client, mode),
        },
        null,
        2,
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
