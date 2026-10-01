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
  application_name: "custodysim-community-upgrade",
  connectionTimeoutMillis: 10000,
})
await client.connect()
try {
  const { rows } = await client.query("SELECT current_database() AS name")
  if (rows[0]?.name !== expected) throw new Error("数据库名称不匹配，未做修改")
  await client.query("BEGIN")
  try {
    await client.query("SET LOCAL lock_timeout = '5s'")
    await client.query(`
      ALTER TABLE profile_records ADD COLUMN IF NOT EXISTS community_share boolean NOT NULL DEFAULT false;
      ALTER TABLE profile_records ADD COLUMN IF NOT EXISTS community_share_fields jsonb NOT NULL DEFAULT '[]'::jsonb;
      CREATE TABLE IF NOT EXISTS community_posts (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        author_id uuid NOT NULL REFERENCES users(id),
        title varchar(120) NOT NULL, content text NOT NULL,
        source_record_id uuid REFERENCES profile_records(id) ON DELETE SET NULL,
        profile_snapshot jsonb,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS community_posts_created_idx ON community_posts(created_at, id);
      CREATE UNIQUE INDEX IF NOT EXISTS community_posts_record_unique ON community_posts(source_record_id);
      CREATE TABLE IF NOT EXISTS community_images (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        post_id uuid NOT NULL REFERENCES community_posts(id) ON DELETE CASCADE,
        data text NOT NULL, position integer NOT NULL
      );
      CREATE INDEX IF NOT EXISTS community_images_post_idx ON community_images(post_id);
      CREATE TABLE IF NOT EXISTS community_comments (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        post_id uuid NOT NULL REFERENCES community_posts(id) ON DELETE CASCADE,
        author_id uuid NOT NULL REFERENCES users(id),
        content text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS community_comments_post_idx ON community_comments(post_id, created_at, id);
    `)
    await client.query("COMMIT")
  } catch (error) {
    await client.query("ROLLBACK")
    throw error
  }
  console.log("社区表和档案自愿分享字段已就绪")
} finally {
  await client.end()
}
