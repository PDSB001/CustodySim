import { createServer } from "node:http"

import { jwtVerify } from "jose"
import pg from "pg"
import { Server } from "socket.io"

const port = Number.parseInt(process.env.REALTIME_PORT || "3001", 10)
const retentionDays = Number.parseInt(
  process.env.CHAT_RETENTION_DAYS || "28",
  10,
)
const cleanupIntervalMs = 6 * 60 * 60 * 1000
const authSecret = process.env.AUTH_SECRET
const databaseUrl = process.env.DATABASE_URL

if (!authSecret || authSecret.length < 32)
  throw new Error("AUTH_SECRET must contain at least 32 characters")
if (!databaseUrl) throw new Error("DATABASE_URL is required")
if (!Number.isInteger(retentionDays) || retentionDays < 1)
  throw new Error("CHAT_RETENTION_DAYS must be a positive integer")

const configuredOrigins = (process.env.APP_ORIGIN || "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean)

const httpServer = createServer((request, response) => {
  if (request.url === "/health") {
    response.writeHead(200, { "content-type": "application/json" })
    response.end(JSON.stringify({ ok: true }))
    return
  }
  response.writeHead(404)
  response.end()
})
const maintenancePool = new pg.Pool({ connectionString: databaseUrl })

const io = new Server(httpServer, {
  path: "/socket.io",
  cors: {
    origin: process.env.NODE_ENV === "production" ? configuredOrigins : true,
    credentials: true,
  },
  transports: ["websocket", "polling"],
})

io.use(async (socket, next) => {
  try {
    const token = socket.handshake.auth?.token
    if (typeof token !== "string") throw new Error("missing token")
    const { payload } = await jwtVerify(
      token,
      new TextEncoder().encode(authSecret),
    )
    if (
      payload.purpose !== "chat-realtime" ||
      typeof payload.sub !== "string" ||
      typeof payload.exp !== "number" ||
      !Array.isArray(payload.conversationIds) ||
      !payload.conversationIds.every((id) => typeof id === "string")
    )
      throw new Error("invalid token")
    socket.data.userId = payload.sub
    socket.data.conversationIds = new Set(payload.conversationIds)
    socket.data.expiresAt = payload.exp * 1000
    next()
  } catch {
    next(new Error("unauthorized"))
  }
})

io.on("connection", (socket) => {
  const expiryTimer = setTimeout(
    () => socket.disconnect(true),
    Math.max(0, socket.data.expiresAt - Date.now()),
  )
  socket.once("disconnect", () => clearTimeout(expiryTimer))
  socket.on("conversation:join", async (conversationId, acknowledge) => {
    if (
      typeof conversationId === "string" &&
      socket.data.conversationIds.has(conversationId)
    ) {
      await socket.join(`conversation:${conversationId}`)
      if (typeof acknowledge === "function") acknowledge({ ok: true })
      return
    }
    if (typeof acknowledge === "function") acknowledge({ ok: false })
  })
  socket.on("conversation:leave", (conversationId) => {
    if (typeof conversationId === "string")
      socket.leave(`conversation:${conversationId}`)
  })
})

async function listenForChatEvents() {
  const client = new pg.Client({ connectionString: databaseUrl })
  client.on("notification", (notification) => {
    if (notification.channel !== "custodysim_chat" || !notification.payload)
      return
    try {
      const event = JSON.parse(notification.payload)
      if (typeof event.conversationId !== "string") return
      io.to(`conversation:${event.conversationId}`).emit("chat:event", event)
    } catch (error) {
      console.error("[chat realtime notification]", error)
    }
  })
  client.on("error", (error) => {
    console.error("[chat realtime postgres]", error)
  })
  client.on("end", () => {
    if (!shuttingDown) setTimeout(connectListener, 5000)
  })
  await client.connect()
  await client.query("LISTEN custodysim_chat")
  return client
}

let listener = null
let shuttingDown = false
let cleanupRunning = false
async function cleanupExpiredChatMessages() {
  if (cleanupRunning) return
  cleanupRunning = true
  try {
    const result = await maintenancePool.query(
      "delete from chat_messages where created_at < now() - ($1 * interval '1 day')",
      [retentionDays],
    )
    if (result.rowCount)
      console.log(`> Deleted ${result.rowCount} expired chat messages`)
  } catch (error) {
    console.error("[chat retention cleanup]", error)
  } finally {
    cleanupRunning = false
  }
}
async function connectListener() {
  try {
    listener = await listenForChatEvents()
    console.log("> Chat realtime listener connected")
  } catch (error) {
    console.error("[chat realtime connect]", error)
    setTimeout(connectListener, 5000)
  }
}

process.on("SIGTERM", async () => {
  shuttingDown = true
  if (listener) await listener.end().catch(() => undefined)
  await maintenancePool.end().catch(() => undefined)
  io.close()
  httpServer.close(() => process.exit(0))
})

connectListener()
cleanupExpiredChatMessages()
setInterval(cleanupExpiredChatMessages, cleanupIntervalMs).unref()
httpServer.listen(port, "0.0.0.0", () => {
  console.log(`> Chat realtime server listening on port ${port}`)
})
