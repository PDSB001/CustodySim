export function registrationCaptchaConfig() {
  const siteKey = process.env.TURNSTILE_SITE_KEY?.trim()
  const secret = process.env.TURNSTILE_SECRET_KEY?.trim()
  return {
    ready: Boolean(siteKey && secret),
    siteKey: siteKey && secret ? siteKey : null,
  }
}

export async function verifyRegistrationCaptcha(
  input: {
    token?: string
    hostname: string
    deviceHash: string
    ip: string | null
  },
  fetcher: typeof fetch = fetch,
) {
  const secret = process.env.TURNSTILE_SECRET_KEY?.trim()
  if (!registrationCaptchaConfig().ready || !secret)
    return "UNAVAILABLE" as const
  if (!input.token || input.token.length > 2048) return "INVALID" as const
  try {
    const response = await fetcher(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          secret,
          response: input.token,
          ...(input.ip ? { remoteip: input.ip } : {}),
        }),
        signal: AbortSignal.timeout(10_000),
        cache: "no-store",
      },
    )
    if (!response.ok) return "UNAVAILABLE" as const
    const result = (await response.json()) as {
      success?: boolean
      hostname?: string
      action?: string
      cdata?: string
      challenge_ts?: string
    }
    const timestamp = Date.parse(result.challenge_ts ?? "")
    const age = Date.now() - timestamp
    return result.success === true &&
      result.hostname?.toLowerCase() === input.hostname.toLowerCase() &&
      result.action === "register" &&
      result.cdata === input.deviceHash &&
      Number.isFinite(timestamp) &&
      age >= -30_000 &&
      age <= 300_000
      ? ("VALID" as const)
      : ("INVALID" as const)
  } catch {
    return "UNAVAILABLE" as const
  }
}
