import { createRequire } from "node:module"
import { runInNewContext } from "node:vm"
import tencentcloud from "tencentcloud-sdk-nodejs-ses"
import { afterEach, expect, it, vi } from "vitest"

const require = createRequire(import.meta.url)

afterEach(() => vi.restoreAllMocks())

it("Drizzle's legacy loader still transforms TypeScript with the patched esbuild", async () => {
  const drizzleRequire = createRequire(require.resolve("drizzle-kit"))
  const loaderRequire = createRequire(
    drizzleRequire.resolve("@esbuild-kit/esm-loader"),
  )
  const core = loaderRequire("@esbuild-kit/core-utils") as {
    transformSync(
      code: string,
      filename: string,
      options: { format: "cjs" },
    ): { code: string }
    transform(
      code: string,
      filename: string,
      options: { format: "cjs" },
    ): Promise<{ code: string }>
  }
  const source =
    "export const total: number = [1, 2, 3].reduce((sum, value) => sum + value, 0)"
  for (const result of [
    core.transformSync(source, "/virtual/schema.ts", { format: "cjs" }),
    await core.transform(source, "/virtual/schema.ts", { format: "cjs" }),
  ]) {
    const fixtureModule = { exports: {} as { total?: number } }
    runInNewContext(result.code, { module: fixtureModule, exports: fixtureModule.exports })
    expect(fixtureModule.exports.total).toBe(6)
  }
})

it("the real Tencent SES SDK creates a UUID trace and parses a response without network", async () => {
  const sdkRequire = createRequire(
    require.resolve("tencentcloud-sdk-nodejs-ses"),
  )
  const commonRequire = createRequire(
    sdkRequire.resolve("tencentcloud-sdk-nodejs-common"),
  )
  const { HttpConnection } = commonRequire("./common/http/http_connection") as {
    HttpConnection: {
      doRequestWithSign3(request: {
        headers: Record<string, string>
      }): Promise<Response>
    }
  }
  // Stub below the SDK request/signing dispatcher: no email or network request is sent.
  const transport = vi
    .spyOn(HttpConnection, "doRequestWithSign3")
    .mockResolvedValue(
      new Response(
        JSON.stringify({
          Response: { MessageId: "test-message", RequestId: "test-request" },
        }),
      ),
    )
  const client = new tencentcloud.ses.v20201002.Client({
    credential: { secretId: "test-only-id", secretKey: "test-only-secret" },
    region: "ap-hongkong",
  })
  await expect(
    client.SendEmail({
      FromEmailAddress: "sender@example.com",
      Destination: ["recipient@example.com"],
      Subject: "Dependency regression",
      Simple: { Text: Buffer.from("test").toString("base64") },
    }),
  ).resolves.toMatchObject({ MessageId: "test-message" })
  expect(transport).toHaveBeenCalledOnce()
  expect(transport.mock.calls[0][0].headers["X-TC-TraceId"]).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  )
})
