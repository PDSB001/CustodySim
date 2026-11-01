import { isIP } from "node:net"

const loopback = (ip) => ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(ip)

export function realtimeClientIp(request, trustProxy) {
  const peer = request.socket.remoteAddress || "unknown"
  const forwarded = request.headers["x-real-ip"]
  return trustProxy &&
    loopback(peer) &&
    typeof forwarded === "string" &&
    isIP(forwarded)
    ? forwarded
    : peer.replace(/^::ffff:/, "")
}

/** Bounded state; reserve before async transport creation, release on close or timeout. */
export function createRealtimeGuard({
  maxConnections = 512,
  maxPerIp = 32,
  maxKeys = 4096,
  burst = 12,
  perMinute = 30,
  now = Date.now,
} = {}) {
  const clients = new Map()
  let active = 0
  let globalTokens = 20
  let globalAt = now()
  function sweep(time) {
    for (const [ip, entry] of clients)
      if (!entry.active && time - entry.at > 60_000) clients.delete(ip)
  }
  return {
    acquire(ip) {
      const time = now()
      if (active >= maxConnections) return null
      let entry = clients.get(ip)
      if (!entry) {
        if (clients.size >= maxKeys) sweep(time)
        if (clients.size >= maxKeys) return null
        entry = { tokens: burst, at: time, active: 0 }
        clients.set(ip, entry)
      }
      entry.tokens = Math.min(
        burst,
        entry.tokens + ((time - entry.at) * perMinute) / 60_000,
      )
      entry.at = time
      globalTokens = Math.min(
        20,
        globalTokens + ((time - globalAt) * 10) / 1000,
      )
      globalAt = time
      if (entry.active >= maxPerIp || entry.tokens < 1 || globalTokens < 1)
        return null
      entry.tokens -= 1
      globalTokens -= 1
      entry.active += 1
      active += 1
      let released = false
      const release = () => {
        if (released) return
        released = true
        entry.active -= 1
        active -= 1
      }
      const timer = setTimeout(release, 10_000)
      timer.unref()
      return {
        attach(socket) {
          clearTimeout(timer)
          if (released) {
            socket.close()
            return
          }
          socket.once("close", release)
        },
      }
    },
  }
}
