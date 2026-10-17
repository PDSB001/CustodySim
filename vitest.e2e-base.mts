import { defineConfig } from "vitest/config"
import { fileURLToPath } from "node:url"
import { config } from "dotenv"
import { resolveE2eDatabaseTarget } from "./scripts/e2e-database-target.mjs"

export function databaseE2eConfig(include: string[]) {
  config({ path: ".env.local", quiet: true })
  const { e2eUrl } = resolveE2eDatabaseTarget({
    businessDatabaseUrl: process.env.DATABASE_URL,
    explicitE2eDatabaseUrl: process.env.E2E_DATABASE_URL,
  })
  process.env.DATABASE_URL = e2eUrl.toString()
  process.env.AUTH_SECRET = "custodysim-e2e-only-auth-secret-32-characters"
  return defineConfig({
    resolve: { alias: { "@": fileURLToPath(new URL("./", import.meta.url)) } },
    test: {
      include,
      fileParallelism: false,
      testTimeout: 30_000,
      hookTimeout: 30_000,
    },
  })
}
