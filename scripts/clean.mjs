#!/usr/bin/env node
import { existsSync, readdirSync, rmSync, statSync } from "node:fs"
import { createConnection } from "node:net"
import { homedir } from "node:os"
import { join, resolve } from "node:path"

/**
 * 抑制开发期磁盘膨胀：只针对"删掉只损失时间、不丢数据"的目录。
 *
 * 默认只报告（dry-run），不会删任何东西：
 *   node scripts/clean.mjs                 # 报告各目录占用
 *   node scripts/clean.mjs --apply         # 真删，并打印回收量
 *   node scripts/clean.mjs --apply --scope=next,test
 *   node scripts/clean.mjs --check         # 超过阈值就退出码 1（给部署前把关）
 *   node scripts/clean.mjs --guard         # 超阈值才静默清理，永不失败（给 predev / e2e 用）
 *
 * 安全边界：候选路径写死在下面白名单里，删除前还会校验它确实位于仓库内或 ~/.gradle 内。
 * 绝不包含 node_modules / .git / .codebuddy / .env* / 任何源码目录。
 */
const repoRoot = resolve(import.meta.dirname, "..")
const home = homedir()

/** Gradle 的 transforms 缓存按版本分目录，本地重算即可，无需联网。 */
function gradleTransformDirs() {
  const caches = join(home, ".gradle", "caches")
  if (!existsSync(caches)) return []
  return readdirSync(caches)
    .filter((name) => /^\d/.test(name))
    .map((name) => join(caches, name, "transforms"))
    .filter((path) => existsSync(path))
}

const SCOPES = {
  // Next 的开发/构建产物。`.next/dev` 是 Turbopack 的开发产物，反复起 dev server
  // （尤其 Playwright 会自己拉一个）会持续累积，实测见过 9G+。
  next: {
    thresholdMb: 800,
    ports: [3000, 3100],
    targets: [{ path: join(repoRoot, ".next"), label: ".next（含 dev 与 cache）" }],
  },
  android: {
    thresholdMb: 1500,
    targets: [
      { path: join(repoRoot, ".app-workspace", ".gradle"), label: ".app-workspace/.gradle" },
      { path: join(repoRoot, ".app-workspace", "app", "build"), label: ".app-workspace/app/build" },
      { path: join(repoRoot, ".app-workspace", "build"), label: ".app-workspace/build" },
      { path: join(repoRoot, ".app-workspace", ".kotlin"), label: ".app-workspace/.kotlin" },
    ],
  },
  test: {
    thresholdMb: 200,
    targets: [
      { path: join(repoRoot, "test-results"), label: "test-results" },
      { path: join(repoRoot, "playwright-report"), label: "playwright-report" },
    ],
  },
  // 仓库外：Gradle 缓存。默认只清"本地可重算"的部分，保留 wrapper（Gradle 本体）
  // 与 caches/modules-2（下载好的依赖），避免下次构建重新下载。
  gradle: {
    thresholdMb: 2000,
    targets: [
      { path: join(home, ".gradle", "daemon"), label: "~/.gradle/daemon（日志）" },
      { path: join(home, ".gradle", "caches", "jars-9"), label: "~/.gradle/caches/jars-9" },
      ...gradleTransformDirs().map((path) => ({ path, label: path.replace(home, "~") })),
    ],
  },
}
const ALL_SCOPES = Object.keys(SCOPES)

function dirSize(path) {
  let total = 0
  let files = 0
  const walk = (current) => {
    let entries
    try {
      entries = readdirSync(current, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const child = join(current, entry.name)
      try {
        if (entry.isDirectory()) walk(child)
        else if (entry.isFile()) {
          total += statSync(child).size
          files += 1
        }
      } catch {
        // 被占用/权限不足的条目直接跳过，不影响整体统计。
      }
    }
  }
  walk(path)
  return { bytes: total, files }
}

/** 端口被监听说明有 dev server 在写这些目录，此时不删，避免把运行中的服务搞坏。 */
function portInUse(port) {
  return new Promise((resolvePromise) => {
    const socket = createConnection({ host: "127.0.0.1", port })
    const done = (inUse) => {
      socket.destroy()
      resolvePromise(inUse)
    }
    socket.setTimeout(400)
    socket.once("connect", () => done(true))
    socket.once("timeout", () => done(false))
    socket.once("error", () => done(false))
  })
}

function withinAllowed(path) {
  const insideRepo = !resolve(path).startsWith("..") && resolve(path).startsWith(repoRoot)
  const insideGradleHome =
    resolve(path).startsWith(join(home, ".gradle")) && resolve(path) !== home
  return insideRepo || insideGradleHome
}

function parseArgs(argv) {
  const scopes = argv
    .filter((arg) => arg.startsWith("--scope="))
    .flatMap((arg) => arg.slice("--scope=".length).split(","))
    .filter(Boolean)
  const threshold = argv.find((arg) => arg.startsWith("--threshold="))
  return {
    apply: argv.includes("--apply"),
    guard: argv.includes("--guard"),
    check: argv.includes("--check"),
    help: argv.includes("--help"),
    scopes: scopes.length ? scopes : ALL_SCOPES,
    thresholdMb: threshold ? Number(threshold.slice("--threshold=".length)) : null,
  }
}

async function collect(scopeNames) {
  const report = []
  for (const name of scopeNames) {
    const scope = SCOPES[name]
    if (!scope) throw new Error(`未知 scope：${name}（可选：${ALL_SCOPES.join(", ")}）`)
    const targets = scope.targets
      .filter((target) => existsSync(target.path))
      .map((target) => ({ ...target, ...dirSize(target.path) }))
    const bytes = targets.reduce((sum, target) => sum + target.bytes, 0)
    const limitMb = scope.thresholdMb
    report.push({
      name,
      limitMb,
      bytes,
      over: bytes > limitMb * 1024 * 1024,
      targets,
      busy: scope.ports ? (await Promise.all(scope.ports.map(portInUse))).some(Boolean) : false,
    })
  }
  return report
}

function printReport(report) {
  for (const scope of report) {
    const mark = scope.over ? "超阈值" : "正常"
    console.log(
      `\n[${scope.name}] 合计 ${mb(scope.bytes)} / 阈值 ${scope.limitMb}MB —— ${mark}${
        scope.busy ? "（检测到 dev server 占用，跳过清理）" : ""
      }`,
    )
    for (const target of scope.targets)
      console.log(`  ${mb(target.bytes).padStart(10)}  ${target.label}（${target.files} 文件）`)
  }
  const total = report.reduce((sum, scope) => sum + scope.bytes, 0)
  console.log(`\n可清理合计：${mb(total)}`)
}

function mb(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    console.log(
      [
        "node scripts/clean.mjs [--apply] [--check] [--guard] [--scope=next,android,test,gradle] [--threshold=MB]",
        "",
        "  默认（无参数）  只报告各目录占用，不删除任何文件",
        "  --apply         删除命中 scope 下的可再生成目录",
        "  --check         任一 scope 超阈值则退出码 1（部署前把关用）",
        "  --guard         超阈值才清理，静默且永不失败（predev / e2e 钩子用）",
        "  --threshold=MB  覆盖阈值；--scope 指定 scope",
      ].join("\n"),
    )
    return 0
  }

  const scopes = args.guard ? ["next"] : args.scopes
  const report = await collect(scopes)
  const override = args.thresholdMb
  if (override !== null) for (const scope of report) scope.over = scope.bytes > override * 1024 * 1024

  const over = report.filter((scope) => scope.over)

  if (args.guard) {
    // 钩子场景：正常时不输出噪音，超阈值才动手，且永不因清理失败而中断链路。
    if (!over.length) return 0
    for (const scope of over) {
      if (scope.busy) {
        console.warn(`\n[${scope.name}] 检测到端口占用（dev server 在跑），跳过。`)
        continue
      }
      prune(scope)
    }
    return 0
  }

  printReport(report)

  if (args.check) {
    if (over.length) {
      console.error(
        `\n超出阈值：${over.map((scope) => `${scope.name}(${mb(scope.bytes)})`).join(", ")}。` +
          `\n执行 node scripts/clean.mjs --apply 清理后再继续。`,
      )
      return 1
    }
    console.log("\n全部在阈值内。")
    return 0
  }

  if (!args.apply) {
    console.log("\n（当前为只报告模式；加 --apply 才会删除）")
    return 0
  }

  let reclaimed = 0
  for (const scope of report) {
    if (scope.busy) {
      console.warn(`\n[${scope.name}] 检测到端口占用（dev server 在跑），跳过。`)
      continue
    }
    reclaimed += prune(scope)
  }
  console.log(`\n已回收约 ${mb(reclaimed)}。`)
  return 0
}

function prune(scope) {
  let reclaimed = 0
  console.log(`\n[${scope.name}] 清理中…`)
  for (const target of scope.targets) {
    if (!withinAllowed(target.path)) {
      console.warn(`  跳过（不在白名单范围内）：${target.path}`)
      continue
    }
    try {
      rmSync(target.path, { recursive: true, force: true })
      reclaimed += target.bytes
      console.log(`  已删除 ${target.label} —— 回收 ${mb(target.bytes)}`)
    } catch (error) {
      console.warn(`  删除失败 ${target.label}：${error.message}`)
    }
  }
  return reclaimed
}

main()
  .then((code) => {
    process.exitCode = code
  })
  .catch((error) => {
    // guard 场景绝不能把 pnpm dev / e2e 链路带崩。
    console.error(`[clean] ${error.message}`)
    process.exitCode = process.argv.includes("--guard") ? 0 : 1
  })
