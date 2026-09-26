import { describe, expect, it } from "vitest"
import { GET } from "@/app/api/mobile/server-info/route"
import { APP_VERSION } from "@/lib/version"

describe("anonymous mobile server discovery", () => {
  it("publishes only the product and supported native protocol", async () => {
    const response = GET()
    expect(response.status).toBe(200)
    expect(response.headers.get("cache-control")).toBe("no-store")
    expect(await response.json()).toEqual({
      success: true,
      data: {
        product: "CustodySim",
        version: APP_VERSION,
        nativeProtocol: { min: 1, max: 1 },
        realtimePath: "/socket.io/",
      },
    })
  })
})
