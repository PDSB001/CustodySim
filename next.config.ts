import type { NextConfig } from "next"
import { networkInterfaces } from "node:os"

const localNetworkHosts = Object.values(networkInterfaces())
  .flatMap((interfaces) => interfaces ?? [])
  .filter((network) => network.family === "IPv4" && !network.internal)
  .map((network) => network.address)

// 与 proxy.ts 保持同值：CSP 依赖每次请求的 nonce 只能由中间件生成，
// 但其余静态安全头在此兜底，避免中间件未命中时全部丢失。
const fallbackSecurityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(self)",
  },
]

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  allowedDevOrigins: ["127.0.0.1", "localhost", ...localNetworkHosts],
  serverExternalPackages: ["geoip-lite"],
  outputFileTracingIncludes: {
    "/*": ["./node_modules/geoip-lite/data/**/*"],
  },
  async headers() {
    return [{ source: "/:path*", headers: fallbackSecurityHeaders }]
  },
}

export default nextConfig
