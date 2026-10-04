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
  experimental: { proxyClientMaxBodySize: "26mb" },
  /**
   * 关闭内置图片优化器（含它的磁盘缓存）。
   *
   * 站内所有 <Image> 都传了 `unoptimized`（图片本身是 data URL，优化器无从下手），
   * 但只要优化器还在，任何漏传的地方都会走 `/_next/image` 并把结果写进
   * `.next/cache/images` —— 那份缓存**没有过期策略**，只会随时间无限增长。
   * 全局置为 unoptimized 后：不再有 `/_next/image` 端点，也不再写这份磁盘缓存，
   * 对现有渲染没有任何影响（本来就是直接输出 data URL）。
   */
  images: { unoptimized: true },
  allowedDevOrigins: ["127.0.0.1", "localhost", ...localNetworkHosts],
  serverExternalPackages: ["geoip-lite"],
  outputFileTracingIncludes: {
    "/api/library/pdf-worker": [
      "./node_modules/pdfjs-dist/build/pdf.worker.min.mjs",
    ],
    "/api/library/pdf-assets/**": [
      "./node_modules/pdfjs-dist/cmaps/**/*",
      "./node_modules/pdfjs-dist/standard_fonts/**/*",
      "./node_modules/pdfjs-dist/wasm/**/*",
    ],
    "/*": ["./node_modules/geoip-lite/data/**/*"],
  },
  async headers() {
    return [{ source: "/:path*", headers: fallbackSecurityHeaders }]
  },
}

export default nextConfig
