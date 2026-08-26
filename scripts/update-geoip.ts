import { execFile } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { promisify } from "node:util"

import { config } from "dotenv"

config({ path: ".env.local" })

const execFileAsync = promisify(execFile)

function getLicenseKey() {
  if (process.env.MAXMIND_LICENSE_KEY) return process.env.MAXMIND_LICENSE_KEY
  const configPath = process.env.MAXMIND_GEOIP_CONF
  if (!configPath || !existsSync(configPath)) return null
  const configContent = readFileSync(configPath, "utf8")
  return configContent.match(/^\s*LicenseKey\s+(\S+)\s*$/m)?.[1] ?? null
}

async function updateGeoIpDatabase() {
  const licenseKey = getLicenseKey()
  if (!licenseKey)
    throw new Error(
      "缺少 MAXMIND_LICENSE_KEY 或 MAXMIND_GEOIP_CONF，无法更新本地 GeoLite2 数据库",
    )

  const updater = path.join(
    process.cwd(),
    "node_modules",
    "geoip-lite",
    "scripts",
    "updatedb.js",
  )
  if (!existsSync(updater)) throw new Error("未找到 geoip-lite 更新脚本")

  try {
    const { stdout, stderr } = await execFileAsync(
      process.execPath,
      [updater],
      {
        env: { ...process.env, LICENSE_KEY: licenseKey },
      },
    )
    if (stdout) process.stdout.write(stdout)
    if (stderr) process.stderr.write(stderr)
  } catch (error) {
    const result = error as { stdout?: string; stderr?: string }
    if (result.stdout) process.stdout.write(result.stdout)
    if (result.stderr) process.stderr.write(result.stderr)
    if (result.stdout?.includes("[451 Unavailable For Legal Reasons]"))
      throw new Error(
        "MaxMind 拒绝下载 GeoLite2 City 数据库（HTTP 451）。请在 MaxMind 账户中确认 City 数据库下载权限与地区合规性；现有本地 City 数据仍可继续使用。",
      )
    throw error
  }
}

updateGeoIpDatabase().catch((error: unknown) => {
  console.error("GeoLite2 数据库更新失败", error)
  process.exitCode = 1
})
