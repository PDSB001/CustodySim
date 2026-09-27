import { execFileSync } from "node:child_process"
import { resolve } from "node:path"

/**
 * e2e 启动前跑一次清理守卫。
 *
 * Playwright 的 webServer 是**直接调 next dev**（不是 `pnpm dev`，所以 `predev` 钩子
 * 不生效），而它写的是仓库里同一个 `.next` —— 反复跑 e2e 正是 `.next/dev` 越堆越大
 * 的主要原因（实测见过 9G+）。这里在每次 e2e 开始前按阈值清理：
 * 正常规模下完全静默，只有超过阈值才动手。
 */
export default function globalSetup() {
  try {
    execFileSync(process.execPath, [resolve("scripts/clean.mjs"), "--guard"], {
      stdio: "inherit",
    })
  } catch {
    // 清理是尽力而为：失败绝不能拦住测试本身。
  }
}
