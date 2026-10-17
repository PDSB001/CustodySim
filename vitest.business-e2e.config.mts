import { databaseE2eConfig } from "./vitest.e2e-base.mjs"

export default databaseE2eConfig(["e2e/business/**/*.test.ts"])
