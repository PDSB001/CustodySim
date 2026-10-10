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
child.stdout.on("data", (chunk) => {
  output += chunk
})
child.stderr.on("data", (chunk) => {
  output += chunk
})
let spawnError = null
child.on("error", (error) => {
  spawnError = error
})

async function waitFor(predicate, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (spawnError) throw spawnError
    if (child.exitCode !== null) throw new Error(`Realtime exited: ${output}`)
    if (Date.now() >= deadline)
      throw new Error(`Realtime probe timed out: ${output}`)
    await delay(50)
  }
}

const probes = []
function heartbeatProbe(reply) {
  const socket = new WebSocket(
    `ws://127.0.0.1:${realtimePort}/socket.io/?EIO=4&transport=websocket`,
  )
  const probe = {
    socket,
    handshake: null,
    pings: 0,
    closed: false,
    error: null,
  }
  probes.push(probe)
  socket.addEventListener("message", ({ data }) => {
    if (data.startsWith("0")) probe.handshake = JSON.parse(data.slice(1))
    if (data === "2") {
      probe.pings += 1
      if (reply) socket.send("3")
    }
  })
  socket.addEventListener("close", () => {
    probe.closed = true
  })
  socket.addEventListener("error", () => {
    probe.error = "WebSocket failed"
  })
  return probe
}

try {
  await waitFor(() => output.includes("Chat realtime server listening"))
  const response = await fetch(`http://127.0.0.1:${realtimePort}/health`)
  assert.equal(
    response.status,
    503,
    "An unavailable LISTEN connection must fail health checks",
  )
  assert.deepEqual(await response.json(), { ok: false })

  // Exercise real Engine.IO data frames without joining a namespace or touching a database.
  const alive = heartbeatProbe(true)
  const unresponsive = heartbeatProbe(false)
  await waitFor(() => alive.handshake && unresponsive.handshake)
  assert.equal(alive.handshake.pingInterval, 20_000)
  assert.equal(alive.handshake.pingTimeout, 10_000)

  const attempts = () => output.split("[chat realtime connect]").length - 1
  await waitFor(() => attempts() >= 2)
  // connect() rejection and the client's end event describe the same failure.
  // They must schedule one retry, rather than two simultaneous new clients.
  await delay(300)
  assert.equal(attempts(), 2, `Duplicate reconnect attempts: ${output}`)
  console.log("PASS realtime health and single reconnect")

  await waitFor(() => alive.pings > 0 && unresponsive.pings > 0, 25_000)
  await waitFor(() => unresponsive.closed, 15_000)
  await delay(250)
  assert.equal(alive.error, null)
  assert.equal(
    alive.socket.readyState,
    WebSocket.OPEN,
    "Pong must keep the idle transport alive",
  )
  console.log(
    "PASS 20s heartbeat text frames, pong keepalive and 10s missing-pong disconnect",
  )
} finally {
  for (const probe of probes) probe.socket.close()
  child.kill("SIGTERM")
  if (child.exitCode === null)
    await Promise.race([once(child, "exit"), delay(3000)])
  if (child.exitCode === null) child.kill("SIGKILL")
  await new Promise((resolveClose) => rejectingDatabase.close(resolveClose))
}
