import assert from "node:assert/strict"
import { EventEmitter } from "node:events"
import { createRealtimeGuard, realtimeClientIp } from "./realtime-guard.mjs"

let time = 0
const guard = createRealtimeGuard({
  maxConnections: 3,
  maxPerIp: 2,
  burst: 5,
  now: () => time,
})
const socket = () =>
  Object.assign(new EventEmitter(), {
    close() {
      this.emit("close")
    },
  })
const first = guard.acquire("a")
const one = socket()
first.attach(one)
guard.acquire("a").attach(socket())
assert.equal(
  guard.acquire("a"),
  null,
  "per-IP bound includes pre-auth transports",
)
const other = socket()
guard.acquire("b").attach(other)
assert.equal(guard.acquire("c"), null, "global bound spans source IPs")
other.emit("close")
other.emit("close")
guard.acquire("c").attach(socket())
assert.equal(
  guard.acquire("d"),
  null,
  "duplicate close must not release another lease",
)
one.emit("close")
assert.ok(guard.acquire("a"), "closed sockets release their IP quota")

const rate = createRealtimeGuard({ burst: 2, perMinute: 60, now: () => time })
for (let i = 0; i < 2; i++) {
  const connected = socket()
  rate.acquire("a").attach(connected)
  connected.emit("close")
}
assert.equal(rate.acquire("a"), null, "reconnect churn is rate limited")
time = 1000
assert.ok(rate.acquire("a"), "handshake allowance refills with time")
const bounded = createRealtimeGuard({ maxKeys: 2, now: () => time })
for (const ip of ["a", "b"]) {
  const connected = socket()
  bounded.acquire(ip).attach(connected)
  connected.emit("close")
}
assert.equal(
  bounded.acquire("c"),
  null,
  "rotating IPs cannot grow state unboundedly",
)
time += 61_000
assert.ok(bounded.acquire("c"), "inactive IP state is reclaimed")
const request = (peer) => ({
  socket: { remoteAddress: peer },
  headers: { "x-real-ip": "198.51.100.10" },
})
assert.equal(realtimeClientIp(request("198.51.100.11"), true), "198.51.100.11")
assert.equal(realtimeClientIp(request("127.0.0.1"), false), "127.0.0.1")
assert.equal(realtimeClientIp(request("127.0.0.1"), true), "198.51.100.10")
console.log(
  "PASS realtime quotas, churn, bounded state, release and trusted proxy IP",
)
