import { drizzle } from "drizzle-orm/node-postgres"
import { Pool } from "pg"

import * as schema from "@/lib/db/schema"

const databaseUrl = process.env.DATABASE_URL
// 生产环境缺少连接串时立刻失败，避免 pg 静默回退到本机默认库。
if (!databaseUrl && process.env.NODE_ENV === "production")
  throw new Error("DATABASE_URL 未配置：请检查部署环境变量或 .env.local")

const globalForDb = globalThis as unknown as { custodySimPool?: Pool }
const pool =
  globalForDb.custodySimPool ?? new Pool({ connectionString: databaseUrl })
if (process.env.NODE_ENV !== "production") globalForDb.custodySimPool = pool

export const db = drizzle({ client: pool, schema })
