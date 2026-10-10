import { EventEmitter } from "node:events"
import type { Socket } from "socket.io-client"
import { describe, expect, it, vi } from "vitest"
import { subscribeChatRealtimeSession } from "@/lib/chat-realtime-session"

function fixture() {
  const events = new EventEmitter()
  const join = vi.fn()
  const socket = Object.assign(events, {
    id: "first",
    connected: false,
    timeout: vi.fn(() => ({ emit: join })),
  }) as unknown as Socket
  const callbacks = { onJoined: vi.fn(), onCredentialExpired: vi.fn() }
  const cleanup = subscribeChatRealtimeSession(
    socket,
    "conversation",
    callbacks,
  )
  const acknowledge = (error: Error | null = null, ok = true) => {
    const callback = join.mock.calls.at(-1)![2] as (
      error: Error | null,
      result: { ok: boolean },
    ) => void
    callback(error, { ok })
  }
  return { events, socket, join, callbacks, cleanup, acknowledge }
}

describe("chat realtime recovery", () => {
  it("rejoins after every connection and only catches up after a successful join", () => {
    const f = fixture()
    f.socket.connected = true
    f.events.emit("connect")
    expect(f.join).toHaveBeenLastCalledWith(
      "conversation:join",
      "conversation",
      expect.any(Function),
    )
    f.acknowledge()
    expect(f.callbacks.onJoined).toHaveBeenCalledTimes(1)
    f.events.emit("disconnect", "ping timeout")
    f.socket.id = "reconnected"
    f.events.emit("connect")
    f.acknowledge()
    expect(f.join).toHaveBeenCalledTimes(2)
    expect(f.callbacks.onJoined).toHaveBeenCalledTimes(2)
    expect(f.callbacks.onCredentialExpired).not.toHaveBeenCalled()
    f.cleanup()
  })

  it("requests fresh credentials for server expiry or rejected auth, not network errors", () => {
    const f = fixture()
    f.events.emit("disconnect", "transport close")
    f.events.emit("connect_error", new Error("network unavailable"))
    expect(f.callbacks.onCredentialExpired).not.toHaveBeenCalled()
    f.events.emit("disconnect", "io server disconnect")
    f.events.emit("connect_error", new Error("unauthorized"))
    expect(f.callbacks.onCredentialExpired).toHaveBeenCalledTimes(2)
    f.cleanup()
  })

  it("ignores rejected, timed out and stale join acknowledgements", () => {
    const f = fixture()
    f.socket.connected = true
    f.events.emit("connect")
    f.acknowledge(null, false)
    f.acknowledge(new Error("timeout"))
    f.socket.id = "another-connection"
    f.acknowledge()
    expect(f.callbacks.onJoined).not.toHaveBeenCalled()
    f.cleanup()
  })

  it("removes listeners and ignores late acknowledgements after leaving the page", () => {
    const f = fixture()
    f.socket.connected = true
    f.events.emit("connect")
    f.cleanup()
    f.acknowledge()
    f.events.emit("connect")
    f.events.emit("disconnect", "io server disconnect")
    expect(f.join).toHaveBeenCalledTimes(1)
    expect(f.callbacks.onJoined).not.toHaveBeenCalled()
    expect(f.callbacks.onCredentialExpired).not.toHaveBeenCalled()
    expect(f.events.eventNames()).toEqual([])
  })
})
