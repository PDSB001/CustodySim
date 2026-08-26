import { defineConfig } from "vitest/config"
import { fileURLToPath, URL } from "node:url"

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./", import.meta.url)) } },
  test: { include: ["lib/__tests__/**/*.test.ts"] },
})
