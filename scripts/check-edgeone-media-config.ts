import { edgeMediaEnabled } from "../lib/edgeone-media"

try {
  console.log(
    `[edgeone-media] ${edgeMediaEnabled() ? "enabled; signing configuration valid" : "disabled; original authenticated image routes remain active"}`,
  )
} catch (error) {
  console.error(
    error instanceof Error
      ? error.message
      : "Invalid EdgeOne media configuration",
  )
  process.exitCode = 1
}
