import { afterEach, beforeEach, expect, test, vi } from "vitest"
import { verifyRegistrationCaptcha } from "@/lib/registration-captcha"
beforeEach(() => {
  vi.stubEnv("TURNSTILE_SITE_KEY", "unit-site")
  vi.stubEnv("TURNSTILE_SECRET_KEY", "unit-secret")
})
afterEach(() => vi.unstubAllEnvs())
const input = {
  token: "token",
  hostname: "www.jxydev.top",
  deviceHash: "a".repeat(64),
  ip: "192.0.2.1",
}
function verifier(overrides: Record<string, unknown> = {}) {
  return vi
    .fn<typeof fetch>()
    .mockResolvedValue(
      Response.json({
        success: true,
        hostname: input.hostname,
        action: "register",
        cdata: input.deviceHash,
        challenge_ts: new Date().toISOString(),
        ...overrides,
      }),
    )
}
test("requires server credentials and a token before provider calls", async () => {
  const fetcher = verifier()
  expect(
    await verifyRegistrationCaptcha({ ...input, token: "" }, fetcher),
  ).toBe("INVALID")
  vi.stubEnv("TURNSTILE_SECRET_KEY", "")
  expect(await verifyRegistrationCaptcha(input, fetcher)).toBe("UNAVAILABLE")
  expect(fetcher).not.toHaveBeenCalled()
})
test("binds valid challenge to hostname, action, browser and five minute lifetime", async () => {
  expect(await verifyRegistrationCaptcha(input, verifier())).toBe("VALID")
  for (const override of [
    { success: false },
    { hostname: "attacker.test" },
    { action: "login" },
    { cdata: "other" },
    { challenge_ts: new Date(Date.now() - 301000).toISOString() },
    { challenge_ts: new Date(Date.now() + 60000).toISOString() },
    { challenge_ts: "invalid" },
  ]) {
    expect(await verifyRegistrationCaptcha(input, verifier(override))).toBe(
      "INVALID",
    )
  }
})
test("provider/network errors fail closed", async () => {
  expect(
    await verifyRegistrationCaptcha(
      input,
      vi.fn<typeof fetch>().mockRejectedValue(new Error("offline")),
    ),
  ).toBe("UNAVAILABLE")
  expect(
    await verifyRegistrationCaptcha(
      input,
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response("error", { status: 503 })),
    ),
  ).toBe("UNAVAILABLE")
})
