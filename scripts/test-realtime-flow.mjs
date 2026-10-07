import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { once } from "node:events"
import { createServer } from "node:net"
import { dirname, resolve } from "node:path"
import { setTimeout as delay } from "node:timers/promises"
import { fileURLToPath } from "node:url"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
// Own the database port and reject its connections: this fixture cannot reach
// any real PostgreSQL instance or execute the retention cleanup against data.
const rejectingDatabase = createServer((socket) => socket.destroy())
rejectingDatabase.listen(0, "127.0.0.1")
await once(rejectingDatabase, "listening")
const databasePort = rejectingDatabase.address().port

const portReservation = createServer()
portReservation.listen(0, "127.0.0.1")
await once(portReservation, "listening")
const realtimePort = portReservation.address().port
await new Promise((resolveClose) => portReservation.close(resolveClose))

const child = spawn(process.execPath, ["realtime-server.mjs"], {
  cwd: root,
  env: {
    ...process.env,
    AUTH_SECRET: "custodysim-realtime-test-secret-32-characters",
    DATABASE_URL: `postgresql://fixture:fixture@127.0.0.1:${databasePort}/fixture`,
    REALTIME_PORT: String(realtimePort),
    NODE_ENV: "test",
  },
  stdio: ["ignore", "pipe", "pipe"],
  windowsHide: true,
})
let output = ""
child.stdout.on("data", (chunk) => { output += chunk })
child.stderr.on("data", (chunk) => { output += chunk })
let spawnError = null
child.on("error", (error) => { spawnError = error })

async function waitFor(predicate) {
  const deadline = Date.now() + 20_000
  while (!predicate()) {
    if (spawnError) throw spawnError
    if (child.exitCode !== null) throw new Error(`Realtime exited: ${output}`)
    if (Date.now() >= deadline) throw new Error(`Realtime probe timed out: ${output}`)
    await delay(50)
  }
}

try {
  await waitFor(() => output.includes("Chat realtime server listening"))
  const response = await fetch(`http://127.0.0.1:${realtimePort}/health`)
  assert.equal(response.status, 503, "An unavailable LISTEN connection must fail health checks")
  assert.deepEqual(await response.json(), { ok: false })

  const attempts = () => output.split("[chat realtime connect]").length - 1
  await waitFor(() => attempts() >= 2)
  // connect() rejection and the client's end event describe the same failure.
  // They must schedule one retry, rather than two simultaneous new clients.
  await delay(300)
  assert.equal(attempts(), 2, `Duplicate reconnect attempts: ${output}`)
  console.log("PASS realtime health and single reconnect")
} finally {
  child.kill("SIGTERM")
  if (child.exitCode === null)
    await Promise.race([once(child, "exit"), delay(3000)])
  if (child.exitCode === null) child.kill("SIGKILL")
  await new Promise((resolveClose) => rejectingDatabase.close(resolveClose))
}
