import { spawn } from "node:child_process"
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readlinkSync,
  statSync,
  symlinkSync,
  unlinkSync,
} from "node:fs"
import { dirname, isAbsolute, relative, resolve, sep } from "node:path"
import { fileURLToPath } from "node:url"

const root = fileURLToPath(new URL("../", import.meta.url))
const database = new URL(process.env.DATABASE_URL ?? "")
if (
  decodeURIComponent(database.pathname) !== "/custodysim_e2e" ||
  process.env.NODE_ENV !== "production"
)
  throw new Error(
    "Production E2E may only run with NODE_ENV=production and custodysim_e2e",
  )

async function run(args) {
  const child = spawn(process.execPath, args, {
    cwd: root,
    stdio: "inherit",
    env: process.env,
  })
  const stop = () => child.kill("SIGTERM")
  process.once("SIGTERM", stop)
  process.once("SIGINT", stop)
  try {
    return await new Promise((resolveExit, reject) => {
      child.once("error", reject)
      child.once("exit", (code) => resolveExit(code ?? 1))
    })
  } finally {
    process.removeListener("SIGTERM", stop)
    process.removeListener("SIGINT", stop)
  }
}

// Match `pnpm build`: TS 7 checks the project before Next's compatibility checker.
const checked = await run([
  "node_modules/@typescript/native/bin/tsc",
  "--noEmit",
])
if (checked !== 0) process.exit(checked)
const built = await run(["node_modules/next/dist/bin/next", "build"])
if (built !== 0) process.exit(built)
const runtime = resolve(root, ".next/standalone")
mkdirSync(resolve(runtime, ".next"), { recursive: true })
cpSync(resolve(root, ".next/static"), resolve(runtime, ".next/static"), {
  recursive: true,
})
if (existsSync(resolve(root, "public")))
  cpSync(resolve(root, "public"), resolve(runtime, "public"), {
    recursive: true,
  })
// Some Next/pnpm outputs on Windows contain file symlinks pointing to directories,
// which Node rejects with EPERM. Normalize only generated, internal directory links.
function normalizeDirectoryLinks(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name)
    if (entry.isSymbolicLink()) {
      const target = resolve(dirname(path), readlinkSync(path))
      const child = relative(runtime, target)
      if (
        !child ||
        child === ".." ||
        child.startsWith(`..${sep}`) ||
        isAbsolute(child)
      )
        continue
      if (statSync(target).isDirectory()) {
        unlinkSync(path)
        symlinkSync(target, path, "junction")
      }
    } else if (entry.isDirectory()) normalizeDirectoryLinks(path)
  }
}
if (process.platform === "win32") normalizeDirectoryLinks(runtime)
process.exitCode = await run([resolve(runtime, "server.js")])
