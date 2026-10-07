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

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const fixtureRoot = await mkdtemp(join(tmpdir(), "custodysim-clean-"))
const fixtureScript = join(fixtureRoot, "scripts", "clean.mjs")
const fixtureCache = join(fixtureRoot, ".next")
const blocker = createServer((socket) => socket.end())

async function runGuard() {
  await promisify(execFile)(
    process.execPath,
    [fixtureScript, "--guard", "--threshold=0"],
    { cwd: fixtureRoot, timeout: 10_000 },
  )
}

try {
  blocker.listen(0, "127.0.0.1")
  await once(blocker, "listening")
  const port = blocker.address().port

  // The guard derives repoRoot from its own path. Copy it to a temporary
  // workspace and point only that copy at our own ephemeral listening port.
  const source = await readFile(join(root, "scripts", "clean.mjs"), "utf8")
  const productionPorts = "ports: [3000, 3100]"
  assert.ok(source.includes(productionPorts), "Expected Next dev ports in clean.mjs")
  await mkdir(dirname(fixtureScript), { recursive: true })
  await writeFile(fixtureScript, source.replace(productionPorts, `ports: [${port}]`))
  await mkdir(fixtureCache)
  await writeFile(join(fixtureCache, "cache.bin"), "rebuildable cache")

  await runGuard()
  assert.ok(existsSync(fixtureCache), "Guard deleted cache while a dev port was busy")

  await new Promise((resolveClose) => blocker.close(resolveClose))
  await runGuard()
  assert.ok(!existsSync(fixtureCache), "Guard failed to prune idle over-limit cache")
  console.log("PASS clean guard skips busy cache and prunes idle cache")
} finally {
  if (blocker.listening)
    await new Promise((resolveClose) => blocker.close(resolveClose))
  await rm(fixtureRoot, { recursive: true, force: true })
}
