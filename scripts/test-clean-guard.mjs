import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import { once } from "node:events"
import { existsSync } from "node:fs"
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { createServer } from "node:net"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { promisify } from "node:util"
import { fileURLToPath } from "node:url"
import { withinAllowed } from "./clean.mjs"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const fixtureRoot = await mkdtemp(join(tmpdir(), "custodysim-clean-"))
const fixtureScript = join(fixtureRoot, "scripts", "clean.mjs")
const fixtureCache = join(fixtureRoot, ".next")
const blocker = createServer((socket) => socket.end())

async function runGuard() {
  await promisify(execFile)(
    process.execPath,
    [fixtureScript, "--guard", "--threshold=0"],
    {
      cwd: fixtureRoot,
      timeout: 10_000,
      env: { ...process.env, E2E_BASE_URL: "", PORT: String(blocker.address()?.port ?? "") },
    },
  )
}

try {
  blocker.listen(0, "127.0.0.1")
  await once(blocker, "listening")

  // The guard derives repoRoot from its own path. Copy it to a temporary
  // workspace and point only that copy at our own ephemeral listening port.
  const source = await readFile(join(root, "scripts", "clean.mjs"), "utf8")
  await mkdir(dirname(fixtureScript), { recursive: true })
  // The fixture must not observe a real developer/E2E server on a default port.
  const productionPorts = "ports: [3000, 3100, 3102, ...configuredPorts()]"
  assert.ok(source.includes(productionPorts))
  await writeFile(fixtureScript, source.replace(productionPorts, "ports: configuredPorts()"))
  await mkdir(fixtureCache)
  await writeFile(join(fixtureCache, "cache.bin"), "rebuildable cache")

  await runGuard()
  assert.ok(
    existsSync(fixtureCache),
    "Guard deleted cache while a dev port was busy",
  )

  await new Promise((resolveClose) => blocker.close(resolveClose))
  await mkdir(join(fixtureCache, "dev"))
  await writeFile(join(fixtureCache, "dev", "lock"), "")
  await runGuard()
  assert.ok(existsSync(fixtureCache), "Guard deleted a locked Next directory")
  await rm(join(fixtureCache, "dev", "lock"))
  await runGuard()
  assert.ok(
    !existsSync(fixtureCache),
    "Guard failed to prune idle over-limit cache",
  )
  console.log("PASS clean guard skips busy cache and prunes idle cache")
  assert.equal(withinAllowed(fixtureRoot, [fixtureRoot]), false)
  assert.equal(withinAllowed(`${fixtureRoot}-old`, [fixtureRoot]), false)
  assert.equal(withinAllowed(join(fixtureRoot, "child"), [fixtureRoot]), true)
  console.log("PASS clean guard rejects roots and sibling prefixes")
} finally {
  if (blocker.listening)
    await new Promise((resolveClose) => blocker.close(resolveClose))
  await rm(fixtureRoot, { recursive: true, force: true })
}
