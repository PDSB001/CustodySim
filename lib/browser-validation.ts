import { z } from "zod"

// Zod's caught Function() feature probe still emits a CSP violation in browsers.
// Keep server validation unchanged and use the interpreter for browser schemas.
if (typeof window !== "undefined") z.config({ jitless: true })

export { z }
