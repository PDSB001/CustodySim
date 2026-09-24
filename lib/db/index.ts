import { drizzle } from "drizzle-orm/node-postgres"
import { Pool } from "pg"

import * as schema from "@/lib/db/schema"

const databaseUrl = process.env.DATABASE_URL
// 生产环境缺少连接串时立刻失败，避免 pg 静默回退到本机默认库。
if (!databaseUrl && process.env.NODE_ENV === "production")
  throw new Error("DATABASE_URL 未配置：请检查部署环境变量或 .env.local")

const globalForDb = globalThis as unknown as { custodySimPool?: Pool }

/**
 * 连接池上限。
 *
 * 服务端 `max_connections` 是 50，应用只占其中一部分：本池 + realtime-server 自己的池 +
 * 手工 psql/监控，都要留余量。将来若 pm2 起多实例，注意 `POOL_MAX × 实例数` 仍要小于上限。
 */
const poolMax = Number(process.env.DATABASE_POOL_MAX) || 20

const pool =
  globalForDb.custodySimPool ??
  new Pool({
    connectionString: databaseUrl,
    application_name: "custodysim-web",
    // 限制应用侧连接数，避免无界申请把 PostgreSQL 连接槽占满。
    max: poolMax,
    // 空闲连接及时归还，长时间无流量时不给数据库留一堆空连接。
    idleTimeoutMillis: 30_000,
    // 取连接的最长等待：超时快速失败，而不是把 HTTP 请求一直挂住。
    connectionTimeoutMillis: 10_000,
    // 单条语句上限：兜住跑飞的查询，防止它长期占着连接（应用不执行 DDL，不影响建索引等维护）。
    statement_timeout: 15_000,
  })
if (process.env.NODE_ENV !== "production") globalForDb.custodySimPool = pool

export const db = drizzle({ client: pool, schema })
