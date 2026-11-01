import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { resolve } from "node:path"
import { config } from "dotenv"
import pg from "pg"

const names = ["audit_logs_created_id_idx", "audit_logs_search_trgm_idx"]
const normalize = (value) => value.toLowerCase().replace(/::text|[()\s]/g, "")
const searchExpression =
  "actor_name || ' ' || action_label || ' ' || action || ' ' || entity_type || ' ' || coalesce(entity_id::text, '') || ' ' || id::text"

export async function inspectAuditIndexes(client) {
  const { rows } = await client.query(
    `
    SELECT c.relname AS name, t.relname AS table, i.indisvalid AS valid,
           i.indisready AS ready, am.amname AS method,
           i.indoption::text AS options,
           pg_get_indexdef(c.oid) AS definition,
           pg_get_expr(i.indexprs, i.indrelid) AS expression,
           pg_get_indexdef(c.oid, 1, true) AS first_key,
           pg_get_indexdef(c.oid, 2, true) AS second_key
    FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid
    JOIN pg_class t ON t.oid=i.indrelid
    JOIN pg_namespace n ON n.oid=c.relnamespace
    JOIN pg_am am ON am.oid=c.relam
    WHERE n.nspname='public' AND c.relname=ANY($1::text[])
  `,
    [names],
  )
  return names.map((name, index) => {
    const actual = rows.find((row) => row.name === name)
    const matches =
      actual?.table === "audit_logs" &&
      (index === 0
        ? actual.method === "btree" &&
          actual.first_key === "created_at" &&
          actual.second_key === "id" &&
          actual.options
            .split(" ")
            .every((option) => (Number(option) & 1) === 1)
        : actual.method === "gin" &&
          actual.definition.includes("gin_trgm_ops") &&
          normalize(actual.expression ?? "") === normalize(searchExpression))
    return {
      name,
      status: !actual
        ? "missing"
        : !matches
          ? "conflict"
          : !actual.valid || !actual.ready
            ? "invalid"
            : "ready",
    }
  })
}

export async function runAuditIndexUpgrade(client, mode = "check") {
  if (!["check", "apply", "rollback"].includes(mode))
    throw new Error("Invalid mode")
  if (mode === "check") return inspectAuditIndexes(client)
  const key = "custodysim:20261101:audit-indexes"
  const { rows } = await client.query(
    "select pg_try_advisory_lock(hashtextextended($1,0)) locked",
    [key],
  )
  if (!rows[0]?.locked)
    throw new Error("Another audit index upgrade is running")
  try {
    const before = await inspectAuditIndexes(client)
    if (
      before.some(
        (index) =>
          index.status === "conflict" ||
          (mode === "apply" && index.status === "invalid"),
      )
    )
      throw new Error(`Audit index preflight failed: ${JSON.stringify(before)}`)
    await client.query("SET lock_timeout='5s'")
    await client.query("SET statement_timeout='30min'")
    const statements =
      mode === "apply"
        ? readFileSync(
            new URL(
              "../lib/db/upgrades/20261101-audit-indexes.up.sql",
              import.meta.url,
            ),
            "utf8",
          )
            .split(";")
            .map((part) => part.trim())
            .filter(Boolean)
        : [...names]
            .reverse()
            .map((name) => `DROP INDEX CONCURRENTLY IF EXISTS public.${name}`)
    for (const statement of statements) await client.query(statement)
    const after = await inspectAuditIndexes(client)
    if (
      after.some(
        (index) => index.status !== (mode === "apply" ? "ready" : "missing"),
      )
    )
      throw new Error(
        `Audit index verification failed: ${JSON.stringify(after)}`,
      )
    return after
  } finally {
    await client.query("select pg_advisory_unlock(hashtextextended($1,0))", [
      key,
    ])
  }
}

async function main() {
  config({ path: ".env.local", quiet: true })
  const args = process.argv.slice(2)
  const modes = args.filter((arg) =>
    ["--check", "--apply", "--rollback"].includes(arg),
  )
  if (
    modes.length > 1 ||
    args.some((arg) => !modes.includes(arg) && !arg.startsWith("--database="))
  )
    throw new Error(
      "Use [--check|--apply|--rollback] --database=<expected name>",
    )
  const expected = args.find((arg) => arg.startsWith("--database="))?.slice(11)
  if (!expected || !process.env.DATABASE_URL)
    throw new Error("DATABASE_URL and --database are required")
  const client = new pg.Client({
    connectionString: process.env.DATABASE_URL,
    connectionTimeoutMillis: 10000,
  })
  await client.connect()
  try {
    const { rows } = await client.query("select current_database() name")
    if (rows[0]?.name !== expected)
      throw new Error("Database mismatch; no changes made")
    console.log(
      JSON.stringify(
        await runAuditIndexUpgrade(client, modes[0]?.slice(2) ?? "check"),
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
