import { config } from "dotenv"
import pg from "pg"

config({ path: ".env.local", quiet: true })
const expectedDatabase = process.argv.find((arg) => arg.startsWith("--database="))?.slice(11)
if (!expectedDatabase || !process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL and --database=<expected database name> are required")
}
const client = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  connectionTimeoutMillis: 10_000,
  application_name: "custodysim-chat-caption-upgrade",
})
await client.connect()
try {
  const { rows } = await client.query("SELECT current_database() AS name")
  if (rows[0]?.name !== expectedDatabase)
    throw new Error("Connected database does not match --database; no changes applied")
  await client.query("BEGIN")
  try {
    await client.query("SET LOCAL lock_timeout = '5s'")
    await client.query("ALTER TABLE public.chat_messages ADD COLUMN IF NOT EXISTS caption text")
    await client.query("COMMIT")
  } catch (error) {
    await client.query("ROLLBACK")
    throw error
  }
  const result = await client.query(`
    SELECT data_type FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'chat_messages' AND column_name = 'caption'
  `)
  if (result.rows[0]?.data_type !== "text") throw new Error("caption column verification failed")
  console.log(`chat_messages.caption ready in ${expectedDatabase}`)
} finally {
  await client.end()
}
