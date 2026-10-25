// Test process preload only. Never imported by application code or deployment.
if (
  new URL(process.env.DATABASE_URL).pathname !== "/custodysim_e2e" ||
  process.env.TURNSTILE_SECRET_KEY !== "custodysim-e2e-turnstile-secret"
) {
  throw new Error(
    "Turnstile fixture requires isolated custodysim_e2e database and test credentials",
  )
}
const originalFetch = globalThis.fetch
const used = new Set()
globalThis.fetch = async (input, init) => {
  const url =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.href
        : input.url
  if (url !== "https://challenges.cloudflare.com/turnstile/v0/siteverify")
    return originalFetch(input, init)
  try {
    const body = JSON.parse(init.body)
    const challenge = JSON.parse(
      Buffer.from(body.response, "base64url").toString("utf8"),
    )
    const valid =
      body.secret === process.env.TURNSTILE_SECRET_KEY &&
      !used.has(body.response)
    used.add(body.response)
    return Response.json({
      success: valid,
      hostname: challenge.hostname,
      action: "register",
      cdata: challenge.cdata,
      challenge_ts: challenge.timestamp,
    })
  } catch {
    return Response.json({ success: false })
  }
}
