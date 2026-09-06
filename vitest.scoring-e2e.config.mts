import { defineConfig } from "vitest/config"
import { fileURLToPath } from "node:url"
import { config } from "dotenv"

config({ path: ".env.local", quiet: true })
const business = process.env.DATABASE_URL
if (!business) throw new Error("DATABASE_URL is required")
const target = new URL(process.env.E2E_DATABASE_URL ?? business)
if (!process.env.E2E_DATABASE_URL) target.pathname = "/custodysim_e2e"
if (decodeURIComponent(target.pathname) !== "/custodysim_e2e")
  throw new Error("Scoring E2E requires custodysim_e2e")
const original = new URL(business)
if (decodeURIComponent(original.pathname) === "/custodysim_e2e")
  throw new Error("Business database must be separate from custodysim_e2e")
process.env.DATABASE_URL = target.toString()
process.env.AUTH_SECRET = "custodysim-e2e-only-auth-secret-32-characters"

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./", import.meta.url)) } },
  test: {
    include: ["e2e/scoring/**/*.test.ts"],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
})
