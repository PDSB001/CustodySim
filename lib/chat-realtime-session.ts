import type { Socket } from "socket.io-client"

/** Restore subscriptions after every transport reconnect; never extend JWT validity. */
export function subscribeChatRealtimeSession(
  socket: Socket,
  conversationId: string,
  callbacks: { onJoined: () => void; onCredentialExpired: () => void },
) {
  let disposed = false
  const connect = () => {
    const connectionId = socket.id
    socket
      .timeout(5_000)
      .emit(
        "conversation:join",
        conversationId,
        (error: Error | null, result?: { ok?: boolean }) => {
          if (
            !disposed &&
            socket.connected &&
            socket.id === connectionId &&
            !error &&
            result?.ok
          )
            callbacks.onJoined()
        },
      )
  }
  const disconnect = (reason: string) => {
    // Server-initiated expiry disables Socket.IO's automatic reconnect.
    if (reason === "io server disconnect") callbacks.onCredentialExpired()
  }
  const connectError = (error: Error) => {
    if (error.message === "unauthorized") callbacks.onCredentialExpired()
  }
  socket.on("connect", connect)
  socket.on("disconnect", disconnect)
  socket.on("connect_error", connectError)
  if (socket.connected) connect()
  return () => {
    disposed = true
    socket.off("connect", connect)
    socket.off("disconnect", disconnect)
    socket.off("connect_error", connectError)
  }
}
