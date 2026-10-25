import { config } from "dotenv"
import pg from "pg"

config({ path: ".env.local", quiet: true })
const expected = process.argv
  .find((arg) => arg.startsWith("--database="))
  ?.slice(11)
if (!expected || !process.env.DATABASE_URL)
  throw new Error("需要 DATABASE_URL 和 --database=<目标数据库名>")
const client = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  connectionTimeoutMillis: 10_000,
})
await client.connect()
try {
  const { rows } = await client.query("SELECT current_database() AS name")
  if (rows[0]?.name !== expected) throw new Error("数据库名称不匹配，未做修改")
  await client.query("BEGIN")
  try {
    await client.query("SET LOCAL lock_timeout = '5s'")
    await client.query(`CREATE TABLE IF NOT EXISTS public.push_devices (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), installation_id uuid NOT NULL, secret_hash varchar(64) NOT NULL,
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE, binding_id uuid NOT NULL DEFAULT gen_random_uuid(),
 token_version integer NOT NULL, provider_token varchar(256), enabled boolean NOT NULL DEFAULT true, updated_at timestamptz NOT NULL DEFAULT now());
CREATE UNIQUE INDEX IF NOT EXISTS push_devices_installation_unique ON push_devices(installation_id);
CREATE INDEX IF NOT EXISTS push_devices_user_idx ON push_devices(user_id,enabled);
CREATE TABLE IF NOT EXISTS public.push_deliveries (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), device_id uuid NOT NULL REFERENCES push_devices(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE, binding_id uuid NOT NULL, event_key varchar(180) NOT NULL,
 kind varchar(16) NOT NULL, entity_id uuid NOT NULL, conversation_id uuid, state varchar(20) NOT NULL DEFAULT 'PENDING',
 attempts integer NOT NULL DEFAULT 0, available_at timestamptz NOT NULL DEFAULT now(), lease_until timestamptz,
 delivered_at timestamptz, error_code varchar(80), created_at timestamptz NOT NULL DEFAULT now());
CREATE UNIQUE INDEX IF NOT EXISTS push_deliveries_event_device_unique ON push_deliveries(device_id,event_key);
CREATE INDEX IF NOT EXISTS push_deliveries_pending_idx ON push_deliveries(state,available_at);`)
    await client.query("COMMIT")
  } catch (error) {
    await client.query("ROLLBACK")
    throw error
  }
  console.log(`通知设备与队列已就绪：${expected}`)
} finally {
  await client.end()
}
