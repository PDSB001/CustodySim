import { defineConfig } from "vitest/config"
import base from "./vitest.scoring-e2e.config.mjs"

export default defineConfig({
  ...base,
  test: { ...base.test, include: ["e2e/business/**/*.test.ts"] },
})
