import { readFileSync } from "node:fs"
import path from "node:path"
import { runInNewContext } from "node:vm"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { expect, test } from "vitest"

test("local environment cannot turn production PM2 services into development servers", () => {
  const fixtureModule = {
    exports: {} as { apps: Array<{ env: Record<string, unknown> }> },
    require: (name: string) => {
      if (name === "node:path") return path
      if (name === "node:fs")
        return {
          existsSync: () => true,
          readFileSync: () =>
            "NODE_ENV=development\nPORT=9999\nREALTIME_PORT=9998\nTZ=UTC\nAUTH_SECRET=test-only\n",
        }
      throw new Error("Unexpected module")
    },
  }
  runInNewContext(
    readFileSync(
      new URL("../../ecosystem.config.cjs", import.meta.url),
      "utf8",
    ),
    {
      module: fixtureModule,
      __dirname: "/fixture",
    },
  )
  const [web, realtime] = fixtureModule.exports.apps
  expect(web.env).toMatchObject({
    NODE_ENV: "production",
    TZ: "Asia/Shanghai",
    PORT: 3000,
    AUTH_SECRET: "test-only",
  })
  expect(realtime.env).toMatchObject({
    NODE_ENV: "production",
    REALTIME_PORT: 3001,
  })
})

test("MFA reset requires explicit database confirmation before connecting", () => {
  const result = spawnSync(
    process.execPath,
    [
      fileURLToPath(new URL("../../reset-mfa.mjs", import.meta.url)),
      "fixture",
      "--apply",
    ],
    {
      env: {
        ...process.env,
        NODE_ENV: "test",
        DATABASE_URL: "postgresql://unused@127.0.0.1:1/production_fixture",
      },
      encoding: "utf8",
      timeout: 5000,
    },
  )
  expect(result.status).toBe(1)
  expect(result.stderr).toContain("--confirm-database")
})
