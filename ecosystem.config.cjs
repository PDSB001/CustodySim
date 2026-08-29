const fs = module.require("node:fs")
const path = module.require("node:path")

// Load variables from .env.local so the standalone server has AUTH_SECRET,
// DATABASE_URL etc. at runtime (standalone mode does not load .env.local itself).
function loadEnvLocal() {
  const envPath = path.join(__dirname, ".env.local")
  if (!fs.existsSync(envPath)) return {}
  const vars = {}
  for (const rawLine of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith("#")) continue
    const eq = line.indexOf("=")
    if (eq === -1) continue
    const key = line.slice(0, eq).trim()
    let value = line.slice(eq + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    if (key) vars[key] = value
  }
  return vars
}

module.exports = {
  apps: [
    {
      name: "custodysim",
      script: ".next/standalone/server.js",
      instances: 1,
      exec_mode: "fork",
      env: {
        NODE_ENV: "production",
        PORT: 3000,
        ...loadEnvLocal(),
      },
      max_memory_restart: "300M",
      kill_timeout: 30000,
      log_date_format: "YYYY-MM-DD HH:mm:ss",
      error_file: "/var/log/custodysim/error.log",
      out_file: "/var/log/custodysim/out.log",
    },
    {
      name: "custodysim-chat-realtime",
      script: "realtime-server.mjs",
      instances: 1,
      exec_mode: "fork",
      env: {
        NODE_ENV: "production",
        REALTIME_PORT: 3001,
        ...loadEnvLocal(),
      },
      max_memory_restart: "200M",
      kill_timeout: 10000,
      log_date_format: "YYYY-MM-DD HH:mm:ss",
      error_file: "/var/log/custodysim/chat-realtime-error.log",
      out_file: "/var/log/custodysim/chat-realtime.log",
    },
  ],
}
