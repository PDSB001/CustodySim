import { drizzle } from "drizzle-orm/node-postgres"
import { Pool } from "pg"

import * as schema from "@/lib/db/schema"

const databaseUrl = process.env.DATABASE_URL

const globalForDb = globalThis as unknown as { custodySimPool?: Pool }
const pool =
  globalForDb.custodySimPool ?? new Pool({ connectionString: databaseUrl })
if (process.env.NODE_ENV !== "production") globalForDb.custodySimPool = pool

export const db = drizzle({ client: pool, schema })
