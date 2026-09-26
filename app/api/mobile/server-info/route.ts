import { success } from "@/lib/api-response"
import { APP_NAME, APP_VERSION } from "@/lib/version"

/** Public, credential-free discovery. No database, user data or deployment secrets. */
export function GET() {
  return success(
    {
      product: APP_NAME,
      version: APP_VERSION,
      nativeProtocol: { min: 1, max: 1 },
      realtimePath: "/socket.io/",
    },
    { headers: { "Cache-Control": "no-store" } },
  )
}
