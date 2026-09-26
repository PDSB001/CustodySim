import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { runInNewContext } from "node:vm"
import { gzipSync } from "node:zlib"

// Run after next build. Count unique JS references per route, including shared
// chunks; this is a build comparison, not a browser transfer/LCP measurement.
const root = ".next/server/app"
const routes = new Set(process.argv.slice(2))
for (const file of readdirSync(root, { recursive: true })) {
  if (!file.endsWith("page_client-reference-manifest.js")) continue
  const context = {}
  runInNewContext(readFileSync(join(root, file), "utf8"), context)
  for (const [route, manifest] of Object.entries(context.__RSC_MANIFEST)) {
    if (routes.size && !routes.has(route)) continue
    const chunks = [
      ...new Set(
        Object.values(manifest.clientModules)
          .flatMap((module) => module.chunks)
          .filter((chunk) => chunk.endsWith(".js")),
      ),
    ].map((chunk) =>
      readFileSync(join(".next", chunk.replace(/^\/?_next\//, ""))),
    )
    console.log(
      JSON.stringify({
        route,
        chunks: chunks.length,
        bytes: chunks.reduce((sum, chunk) => sum + chunk.length, 0),
        gzipBytes: chunks.reduce(
          (sum, chunk) => sum + gzipSync(chunk).length,
          0,
        ),
      }),
    )
  }
}
