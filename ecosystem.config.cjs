const fs = module.require("node:fs")
const path = module.require("node:path")
const logDirectory = path.join(__dirname, ".logs")

// Load variables from .env.local so the standalone server has AUTH_SECRET,
// DATABASE_URL etc. at runtime (standalone mode does not load .env.local itself).
// 解析单个值：支持引号包裹、行内注释与 \n 转义。
function parseEnvValue(rawValue) {
  const trimmed = rawValue.trim()
  if (!trimmed) return ""
  const quote = trimmed[0]
  if (quote !== '"' && quote !== "'") {
    const hashIndex = trimmed.indexOf(" #")
    const bare = hashIndex === -1 ? trimmed : trimmed.slice(0, hashIndex)
    return bare.trim()
  }
  const body = trimmed.slice(1).replace(/\\n/g, "\n")
  const closing = body.lastIndexOf(quote)
  return closing === -1 ? body : body.slice(0, closing)
}

function loadEnvLocal() {
  const envPath = path.join(__dirname, ".env.local")
  if (!fs.existsSync(envPath)) return {}
  const vars = {}
  for (const rawLine of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    let line = rawLine.trim()
    if (!line || line.startsWith("#")) continue
    if (line.startsWith("export ")) line = line.slice("export ".length).trim()
    const eq = line.indexOf("=")
    if (eq === -1) continue
    const key = line.slice(0, eq).trim()
    if (key) vars[key] = parseEnvValue(line.slice(eq + 1))
  }
  return vars
}

module.exports = {
  apps: [
    {
      name: "custodysim",
      script: ".next/standalone/server.js",
      // 固定 cwd 为仓库根目录：本地 IP 库按 process.cwd()/data/geoip 解析，
      // 显式声明后 pm2 resurrect 也不会因为启动目录不同而找不到数据。
      cwd: __dirname,
      instances: 1,
      exec_mode: "fork",
      env: {
        // 本地 IP 库默认落在仓库根目录；.env.local 里的 GEOIP_DATA_DIR 可覆盖。
        GEOIP_DATA_DIR: path.join(__dirname, "data", "geoip"),
        ...loadEnvLocal(),
        NODE_ENV: "production",
        TZ: "Asia/Shanghai",
        PORT: 3000,
      },
      // 这台机器总内存 1.9G，而 Node 默认的旧生代上限是按机器内存推算的（1G 量级），
      // 于是 V8 迟迟不做激进 GC，pm2 却按 RSS 到 300M 就把进程杀掉 —— 表现就是
      // restarts 一路涨、uptime 只有几分钟，每次被杀还会掐断正在处理的请求。
      // 两个值一起调：先让 V8 在 384M 堆时主动 GC，再给 pm2 留出足够余量
      // （堆 384M + 运行时开销 ≈ 500M）。mmdb 是常驻的 ~96MB Buffer，
      // 记在堆外但计入 RSS，所以上限从 600M 提到 700M。
      node_args: "--max-old-space-size=384",
      max_memory_restart: "700M",
      kill_timeout: 30000,
      log_date_format: "YYYY-MM-DD HH:mm:ss",
      error_file: path.join(logDirectory, "error.log"),
      out_file: path.join(logDirectory, "out.log"),
    },
    {
      name: "custodysim-chat-realtime",
      script: "realtime-server.mjs",
      instances: 1,
      exec_mode: "fork",
      env: {
        ...loadEnvLocal(),
        NODE_ENV: "production",
        TZ: "Asia/Shanghai",
        REALTIME_PORT: 3001,
      },
      max_memory_restart: "200M",
      kill_timeout: 10000,
      log_date_format: "YYYY-MM-DD HH:mm:ss",
      error_file: path.join(logDirectory, "chat-realtime-error.log"),
      out_file: path.join(logDirectory, "chat-realtime.log"),
    },
  ],
}
