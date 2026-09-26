import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { basename, dirname, join, resolve } from "node:path"

// Exercise deployment control flow with stubs: no database, git, or PM2 writes.
const directory = mkdtempSync(join(tmpdir(), "custodysim-deploy-test-"))
const bash =
  process.platform === "win32" ? "C:/Program Files/Git/bin/bash.exe" : "bash"
const posixDirectory = directory
  .replaceAll("\\", "/")
  .replace(/^([A-Za-z]):/, (_, drive) => `/${drive.toLowerCase()}`)
try {
  mkdirSync(join(directory, "scripts"))
  mkdirSync(join(directory, "bin"))
  copyFileSync(
    new URL("./deploy.sh", import.meta.url),
    join(directory, "scripts/deploy.sh"),
  )
  writeFileSync(join(directory, ".env.local"), "")
  for (const command of [
    "git",
    "pnpm",
    "cp",
    "mkdir",
    "pm2",
    "sleep",
    "node",
    "curl",
  ]) {
    const body =
      command === "node"
        ? `
if [[ "$1" == "--input-type=module" ]]; then echo perf_test; exit 0; fi
exit "${"${DEPLOY_TEST_MIGRATION_EXIT:-0}"}"
`
        : command === "curl"
          ? `
if [[ "${"${DEPLOY_TEST_HTTP_FAILURE:-0}"}" == "1" ]]; then printf 500
elif [[ "${"${*: -1}"}" == */api/me ]]; then printf 401
else printf 200; fi
`
          : ""
    writeFileSync(
      join(directory, "bin", command),
      `#!/bin/bash\nprintf '%s\\n' '${command}' >> "$DEPLOY_TEST_LOG"\n${body}`,
      { mode: 0o755 },
    )
  }
  for (const scenario of [
    { name: "deploy", args: [], exit: 0, restart: true },
    {
      name: "migration failure",
      args: [],
      exit: 1,
      restart: false,
      migration: "1",
    },
    { name: "health failure", args: [], exit: 1, restart: true, health: "1" },
    { name: "check", args: ["--check-db"], exit: 0, restart: false },
    { name: "rollback", args: ["--rollback-db"], exit: 0, restart: false },
  ]) {
    const log = join(directory, "commands.log")
    writeFileSync(log, "")
    const result = spawnSync(
      bash,
      [
        "-c",
        'export PATH="$DEPLOY_TEST_BIN:/usr/bin:$PATH"; bash scripts/deploy.sh "$@"',
        "deploy-test",
        ...scenario.args,
      ],
      {
        cwd: directory,
        env: {
          ...process.env,
          DEPLOY_TEST_BIN: `${posixDirectory}/bin`,
          DEPLOY_TEST_LOG: `${posixDirectory}/commands.log`,
          DEPLOY_TEST_MIGRATION_EXIT: scenario.migration ?? "0",
          DEPLOY_TEST_HTTP_FAILURE: scenario.health ?? "0",
        },
        encoding: "utf8",
      },
    )
    assert.equal(
      result.status,
      scenario.exit,
      `${scenario.name}: ${result.stderr}\n${result.stdout}`,
    )
    const calls = readFileSync(log, "utf8").trim().split("\n")
    assert.equal(calls.includes("pm2"), scenario.restart, scenario.name)
    if (scenario.args.length)
      assert.equal(calls.includes("git"), false, scenario.name)
    if (scenario.restart)
      assert.ok(calls.indexOf("node") < calls.indexOf("pm2"))
    console.log(`PASS ${scenario.name}`)
  }
} finally {
  // Remove only the uniquely created fixture directory inside the OS temp root.
  if (
    dirname(resolve(directory)) !== resolve(tmpdir()) ||
    !basename(directory).startsWith("custodysim-deploy-test-")
  )
    throw new Error("Unexpected fixture path")
  rmSync(directory, { recursive: true, force: true })
}
