# 依赖升级记录

核对日期：2026-10-18。版本以 package.json 与 pnpm-lock.yaml 为准；本轮不改变数据库结构或业务接口。Android 同步记录在 [App 仓库](https://github.com/PDSB001/CustodySim-app/blob/main/docs/dependency-upgrades.md)。

## 本轮基线

| 依赖                         | 升级前           | 升级后                      |
| ---------------------------- | ---------------- | --------------------------- |
| Next.js / eslint-config-next | 16.3.3           | 16.4.2                      |
| React / React DOM            | 19.2.8           | 19.3.1                      |
| TypeScript 类型检查          | 5.9.3            | 7.0.2 原生编译器            |
| ESLint                       | 9.39.5           | 10.13.0                     |
| pnpm                         | 12.4.2           | 12.14.0                     |
| Node 类型                    | 20.19.43         | 26.6.5，与 CI Node 26 对齐  |
| Playwright                   | 1.62.1           | 1.64.1，需重新安装 Chromium |
| Vitest                       | 4.1.11           | 5.0.5                       |
| Drizzle ORM / Kit            | 0.45.2 / 0.31.10 | 0.45.4 / 0.31.11            |
| Neon / pg                    | 1.1.0 / 8.23.0   | 1.2.0 / 8.23.1              |
| PDF.js / sharp               | 6.3.289 / 0.35.4 | 6.4.299 / 0.35.5            |
| Socket.IO 服务端 / 客户端    | 4.8.3            | 4.8.4                       |
| TanStack Query / Table       | 5.102.2 / 9.1.2  | 5.104.3 / 9.3.1             |
| Radix / React Hook Form      | 1.6.7 / 7.86.0   | 1.8.1 / 7.90.0              |
| Zod / jose                   | 4.4.3 / 6.2.10   | 4.6.7 / 6.2.12              |
| dotenv                       | 17.4.2           | 18.0.8                      |

Lucide、shadcn、tailwind-merge、Prettier、tsx、React 类型等也已同步更新。pnpm 按[官方 self-update 流程](https://pnpm.io/cli/self-update)固定到 12.14.0，CI 自动读取 packageManager；保留受审查的安装脚本白名单。Next 与 eslint-config-next、React 与 React DOM 均保持相同版本。

[Next.js 16.4 发布说明](https://nextjs.org/blog/next-16-4)与 [10 月安全更新](https://nextjs.org/blog/nextjs-security-update-october-14-2026)用于选择版本。修改框架代码仍须先读安装包内的 node_modules/next/dist/docs；本轮未启用新的缓存模式。

dotenv 18 [移除了旧预加载方式与 .env.vault 支持](https://github.com/motdotla/dotenv/blob/master/CHANGELOG.md)。仓库使用显式 parse/config 和 Node --env-file，不依赖这两项能力；部署配置文件格式不变。

## 主版本兼容方案

ESLint 10、TypeScript 7 已完成迁移，取消上一轮的 Dependabot 暂缓配置。兼容层是当前上游 API 的实际限制，需要继续维护：

- 按 [TypeScript 官方并行方案](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/#running-side-by-side-with-typescript-6-0)，`@typescript/native` 是 typescript 7.0.2 的别名，提供 `tsc`；`typescript` 指向官方 `@typescript/typescript6` 6.0.2 兼容包，转发 6.0.3 API 并提供 `tsc6`。因此 pnpm typecheck 使用原生 7，ESLint 等旧工具仍能读取所需 API。
- Next 16.4 的内建检查按 `typescript/package.json` 选取编译器，因此此并行方案中的 Next 附加检查仍用 6。`pnpm build` 先执行原生 7 的 typecheck，再运行 Next 构建；没有设置 ignoreBuildErrors。CI 的独立类型检查同样使用 7，不能误把兼容包标成“整个仓库仍用 6”或“完全移除了 6”。
- 按 [ESLint 10 迁移指南](https://eslint.org/docs/latest/use/migrate-to-10.0.0)，使用官方 `@eslint/compat` 2.1.1 包装 Next flat config 内的插件规则，适配移除的 context / SourceCode API，保留原有规则。React / import / jsx-a11y 三个插件尚未更新 peer 声明，只为精确插件版本与 ESLint 10.13.0 声明受测兼容组合；其他 peer 检查继续生效。`pnpm peers check` 通过，新增四个违规片段分别验证 React、无障碍、import、TypeScript 规则仍会报错。
- `@types/node` 升到 Node 26 的最新版本 26.6.5（类型包 patch 落后于运行时属正常），与 CI 和生产运行时 26.12.1 保持同一主版本，避免出现"代码用 26 API、声明仍写 24"的错配。

Node 声明统一为 **>=26.0.0**，`.node-version` 固定 **26.12.1**，CI 与本机运行时一致。此前声明 >=20.9.0 不符合当时 geoip-lite >=24 的实际要求（该依赖现已由 maxmind 取代），PDF.js 也要求 >=22.13；部署前须核对 Node。Vitest 按[官方 5.0 迁移指南](https://vitest.dev/guide/migration.html)升级，保留默认 mock 隔离，不关闭新校验。

Node 26.12.1 上复核时发现一个只影响测试夹具的运行时问题：EdgeOne 媒体缓存用例把 3.7MB 正文按 23 字节切分，约 16 万个微块连续转发会让 `structuredClone` 反序列化失败、worker 以 `0xC0000409` 退出；同一份代码在 26.4.0 上正常（已用官方 zip 就地对照确认）。夹具已给单个响应加 1024 块上限，保留跨 UTF-8 边界切块的语义，同时不再制造真实运行时不会出现的微块量级；该重负载用例显式设 20s 超时。部署侧的媒体缓存函数本身未改动。

## 传递依赖修复与安全审计

在 pnpm-workspace.yaml 中仅对两个精确上游消费者配置 overrides，经过实际调用回归后升级：

| 依赖链                                                | 修复版本                                                                              | 验证                                                                                                     |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| drizzle-kit → @esbuild-kit/core-utils 3.3.2 → esbuild | 0.18.20 → 0.28.2，[原告警](https://github.com/advisories/GHSA-67mh-4wv8-2f99)不再命中 | 同步 / 异步 TypeScript loader 可执行；Drizzle 导出的 57,836 字节 schema SQL 逐字相同，无数据库连接或写入 |
| 腾讯 SES SDK → common 4.1.220 → uuid                  | 9.0.1 → 14.0.3，[原告警](https://github.com/advisories/GHSA-w5hq-g745-h8pq)不再命中   | Node 24 的真实 SDK 生成 v4 trace 并解析模拟响应；网络传输被替身拦截，没有发邮件                          |

uuid 14 为 ESM；此定向升级依赖本仓库 Node 24 / >=26 的同步 require(ESM) 能力，不能将旧 SDK 原封不动带到旧 Node。现有 min Node 声明与 CI 已覆盖这个边界；后续 SDK 自行升级对应依赖后应移除 overrides。

最终 pnpm audit 从 **1 high、3 moderate** 降至 **1 high、1 moderate**，不能视为零漏洞。以下两项审计尚未提供上游修复版：

| 依赖链                                                      | 告警 / 上游状态                                                                             | 本轮处理                         |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------- | -------------------------------- |
| shadcn / Next ESLint 插件 → fast-glob → micromatch → braces | [嵌套 pattern 栈耗尽](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm)，审计未提供修复版  | 保留告警，不传入不可信 glob 模式 |
| mammoth → argparse → sprintf-js                             | [超大精度造成拒绝服务](https://github.com/advisories/GHSA-hp3w-g68c-fv3c)，审计未提供修复版 | 保留告警，等待上游补丁           |

后续应跟进上游修复及实际调用范围；不要用 audit --fix --force 或忽略清单把数字清零。

## 验证与更新方式

本轮结果：

| 检查                             | 结果                                                              |
| -------------------------------- | ----------------------------------------------------------------- |
| 冻结锁文件安装、lint、TypeScript | 通过                                                              |
| Vitest 5 单测                    | 394 passed，含四项 ESLint 规则回归、两项传递依赖实际调用回归      |
| 业务 / 积分数据库回归            | 96 + 15 passed，只使用 custodysim_e2e                             |
| 普通桌面 / 移动浏览器最终整轮    | 66 passed、8 skipped、0 flaky                                     |
| 评分与安全浏览器                 | 10 passed                                                         |
| 生产 CSP                         | 2 passed，包含实际 Turbopack standalone 构建                      |
| 运维安全回归                     | 清理守卫、实时连接/心跳、部署替身五场景均通过                     |
| CI 运行时复核                    | Node 24.22.0 / pnpm 12.14.0，TS7 类型检查与完整 test:all 流程通过 |

本机默认 Node 26.4.0，另从官方发行包核对 SHA-256 后，在忽略目录内运行 Node 24.22.0；没有替换系统 Node。此前普通浏览器首轮出现过两项 flaky，禁用重试各复跑三次均通过；后续 pnpm 12.14 的完整流程 66 项普通浏览器全部首轮通过，保留此前证据。完整流程首次单测为 392 项，随后加入传递依赖回归并更新对应依赖，再复核最终 394 项单测、静态检查和生产 CSP 构建。Android 验证在独立仓库，仍未进行真实设备验收或生产流量验证。

现有验证入口：

```bash
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
pnpm exec playwright install chromium
pnpm test:e2e:business
pnpm test:e2e
pnpm test:e2e:scoring
pnpm test:e2e:production
```

数据库与浏览器测试顺序执行，只使用 custodysim_e2e；生产 CSP 套件包含真实 Turbopack standalone 构建。构建及自动化通过仍不等同于生产流量或 Android 真机验收。

Dependabot 每周检查 npm 与 Actions，兼容的 minor/patch 合为一组 PR，主版本单独审查；已取消 ESLint / TypeScript 的版本忽略。升级 PR 仍须审查和现有 CI，不自动合并、不部署生产。插件原生支持 ESLint 10 后应移除对应兼容声明与包装；TypeScript 新 API 被工具链支持后再移除 6 的兼容包。
