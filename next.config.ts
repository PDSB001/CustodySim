import type { NextConfig } from "next"
import { networkInterfaces } from "node:os"

const localNetworkHosts = Object.values(networkInterfaces())
  .flatMap((interfaces) => interfaces ?? [])
  .filter((network) => network.family === "IPv4" && !network.internal)
  .map((network) => network.address)

const nextConfig: NextConfig = {
  output: "standalone",
  allowedDevOrigins: ["127.0.0.1", "localhost", ...localNetworkHosts],
  serverExternalPackages: ["geoip-lite"],
  outputFileTracingIncludes: {
    "/*": ["./node_modules/geoip-lite/data/**/*"],
  },
}

export default nextConfig
