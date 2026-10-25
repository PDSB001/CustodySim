import { config } from "dotenv"
import pg from "pg"
config({ path: ".env.local", quiet: true })
const expected = process.argv
  .find((arg) => arg.startsWith("--database="))
  ?.slice(11)
if (!expected || !process.env.DATABASE_URL)
  throw new Error("需要 DATABASE_URL 和 --database=<目标数据库>")
const client = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  connectionTimeoutMillis: 10_000,
})
await client.connect()
try {
  if (
    (await client.query("select current_database() as name")).rows[0]?.name !==
    expected
  )
    throw new Error("目标数据库不匹配")
  await client.query("BEGIN")
  try {
    await client.query("SET LOCAL lock_timeout='5s'")
    await client.query(`
      CREATE TABLE IF NOT EXISTS registration_settings (id integer PRIMARY KEY DEFAULT 1, enabled boolean NOT NULL DEFAULT true,
        organization_id uuid REFERENCES organizations(id) ON DELETE SET NULL);
      INSERT INTO registration_settings (id) VALUES (1) ON CONFLICT DO NOTHING;
      CREATE TABLE IF NOT EXISTS registrations (user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        email_hash varchar(64) NOT NULL UNIQUE, state varchar(20) NOT NULL DEFAULT 'PENDING',
        trial_start timestamptz NOT NULL, trial_end timestamptz NOT NULL, final_score integer, evaluated_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now());
      CREATE INDEX IF NOT EXISTS registrations_state_end_idx ON registrations(state,trial_end);
      ALTER TABLE registrations ADD COLUMN IF NOT EXISTS device_hash varchar(64);
      ALTER TABLE registrations ADD COLUMN IF NOT EXISTS network_hash varchar(64);
      CREATE INDEX IF NOT EXISTS registrations_device_created_idx ON registrations(device_hash,created_at);
      CREATE INDEX IF NOT EXISTS registrations_network_evaluated_idx ON registrations(network_hash,evaluated_at);
      CREATE TABLE IF NOT EXISTS registration_risk_blocks (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), kind varchar(16) NOT NULL,
        value_hash varchar(64) NOT NULL, reason varchar(300) NOT NULL, expires_at timestamptz, created_at timestamptz NOT NULL DEFAULT now());
      CREATE UNIQUE INDEX IF NOT EXISTS registration_risk_blocks_kind_hash_unique ON registration_risk_blocks(kind,value_hash);
      CREATE TABLE IF NOT EXISTS registration_email_blocks (email_hash varchar(64) PRIMARY KEY, reason varchar(300) NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now());
    `)
    await client.query("COMMIT")
  } catch (error) {
    await client.query("ROLLBACK")
    throw error
  }
  console.log(`自由注册与首周考察数据结构已就绪：${expected}`)
} finally {
  await client.end()
}
