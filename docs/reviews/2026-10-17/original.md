# CustodySim 全仓代码审查报告

- 审查日期：2026-10-17
- 版本：`package.json` → `1.5.2-test`
- 范围：整个 Web 仓库（`app/` `components/` `lib/` `scripts/` `e2e/` 及全部配置与部署文件）。不含 `artifacts/` 下的 Android 构建产物。
- 性质：**只读审查，未修改任何代码**

---

## 0. 给阅读者（LLM）的上下文

这是一个 **Next.js 16 App Router + React 19 + TypeScript(strict) + Drizzle ORM + PostgreSQL + Tailwind 4 + pnpm** 的监管场所任务模拟系统（"CustodySim"）。

结构：

| 目录 | 内容 |
| --- | --- |
| `app/` | 路由。`(auth)` `(dashboard)` `(supervisor)` `(supervised)` 四个路由组；`app/api/**/route.ts` 共 **121** 个接口 |
| `components/` | 104 个 tsx（shadcn/radix 风格） |
| `lib/` | 164 个 ts，业务核心。`lib/db/schema.ts` 1666 行是 schema 唯一真相 |
| `scripts/` | 33 个运维/升级/测试脚本 |
| `e2e/` | Playwright，19 个 spec |
| `proxy.ts` | 全站中间件（TS 后缀，非 `middleware.ts`）：CSP nonce + 同源校验 |
| `ecosystem.config.cjs` | pm2 双进程：Web(standalone) + realtime(socket.io, 3001) |
| `.github/workflows/ci.yml` | 4 个 job：quality / integration / build / gate |

**静态检查结论：全部通过。** `pnpm typecheck`(tsc --noEmit)、`pnpm lint`(eslint --max-warnings 0) 均零错误零告警；全仓 `as any` = 0、`@ts-ignore` = 0、`console.log`(app/lib) = 0、`eslint-disable` = 1（合理且带理由）。

因此下述问题**都不是类型或 lint 能发现的问题**，需要靠逻辑推理、性能建模和运行时行为分析来确认。请按每条给出的 `路径:行号` 自行复核后再给补丁。

严重度定义：**高** = 用户可见功能失效 / 生产事故 / 数据一致性受损；**中** = 安全削弱 / 性能随规模劣化 / 运维误操作风险；**低** = 局部体验或卫生问题。

---

## 1. 高危（6 条）

### H1. 全仓 0 个错误边界与加载态

- 位置：`app/` 全目录
- 现象：`search_file` 全量搜索 `(error|loading|global-error|template)\.tsx` → **0 命中**。项目有 60+ 页面，却没有任何 `error.tsx`、`global-error.tsx`、`loading.tsx`。
- 影响：
  - 任一 Server Component 抛错（DB 超时、zod 失败、null 解引用）→ 生产环境整页 `Application error: a server-side exception has occurred`，用户只能刷新，且无法重试局部。
  - 所有页面导航无骨架屏，首屏白等。
- 建议：至少补 `app/error.tsx`（client，`reset()`）与 `app/global-error.tsx`；路由组级 `(dashboard)/(supervisor)/(supervised)` 各补一个 `loading.tsx` 与 `error.tsx`。

### H2. 空会话里，对端发来的第一条消息不会实时出现

- 位置：`components/chat/chat-workspace.tsx:485`（配合 `:197-200`、`:468-470`、`:476`、`:570`）
- 现象：
  ```tsx
  const tailCursor = historyMessages.at(-1)?.id ?? ""     // :476 空会话 → ""
  const tail = useQuery({ ... enabled: Boolean(selectedId && tailCursor) })  // :485 被禁用
  ```
  socket 的 `message.created` 事件只 `invalidateQueries(["chat-tail", conversationId])`（`:197-200`）；历史页 `useInfiniteQuery` 又刻意不设 `refetchInterval`（`:468`，注释说明是为了避免重复搬运图片）。
  因此：会话为空时，**对方**发的第一条消息到达 → 只 invalidate 一个 `enabled:false` 的查询 → 历史页不重取 → 界面无新消息。必须切走再切回才出现。
- 注意：**自己**发消息不受影响，`:570` 有 `if (historyMessages.length === 0)` 特判去刷历史页；`onJoined`（`:171-180`）重连时也会补刷。缺口只在"steady-state 下对端首条消息"。
- 建议：`message.created` 分支里对 `historyMessages.length === 0` 的情况改刷 `["chat-messages", id]`；或把 tail 查询改成不依赖游标（空游标 = 从头取）。

### H3. 任务引擎在热路径上做 9 次全表扫描

- 位置：`lib/task-engine.ts:62-77`，放大点 `:187`，热路径 `app/api/library/reading/route.ts:30`
- 现象：
  - `ensureUserTasks()` 无条件 `Promise.all` 拉 9 张全集表：`rules`(enabled) / `ruleScopes` / `ruleGroupScopes` / `organizations` / 全部 `role=SUPERVISED` 的 users / `reportTemplates` / `reportTemplateFields` / `taskPools` / `taskPoolTemplates`。**全部无 `limit`、无按 userId 过滤**。
  - `:187` 在被监管人循环里对每个人再调一次 `ensureUserTasks` → 调度器每 5 分钟一次是 O(N) 次全表读。
  - `app/api/library/reading/route.ts:30`：用户**每开始读一本书**（POST /api/library/reading）都 `await ensureUserTasks(actor.id)`，这是最热的写接口之一。
- 影响：用户数增长时，单次开书请求的 DB 往返与内存拷贝线性膨胀；pg 连接占用时间被拉长，与 `lib/db/index.ts:19` 的 `poolMax=20` 形成瓶颈。
- 建议：把"规则→目标用户"的展开结果按 `now` 的分钟级时间窗缓存（进程内 Map + TTL，或一张物化表）；开书路径改为异步触发或仅在跨日期时执行。

### H4. `request.json()` 写在 try 之外，畸形 JSON → 500（57 处）

- 位置（示例）：`app/api/checkins/route.ts:57`、`app/api/makeups/route.ts:77`、`app/api/admin/persons/route.ts:112`、`app/api/mobile/location/batch/route.ts:41`、`app/api/admin/prisoner-numbers/route.ts:35`、`app/api/admin/orgs/sort/route.ts:20`
- 现象：`const parsed = Schema.safeParse(await request.json())`，`request.json()` 抛 `SyntaxError` 时不在任何 `catch` 覆盖内 → Next 返回 500，而不是 400。
- 统计：全仓 67 处 `request.json()`，仅 10 处带 `.catch(() => null)`。正确范式见 `app/api/admin/library/[id]/route.ts:30`：
  ```ts
  const parsed = Schema.safeParse(await request.json().catch(() => null))
  ```
- 影响：客户端传坏 JSON（或网络截断）被记为服务端错误，污染日志与告警；移动端弱网下尤为常见。
- 建议：全量替换为 `.catch(() => null)`，或抽一个 `readJson(request)` helper 统一收口。

### H5. 事务内调用使用全局 `db` 的函数，写操作逃出事务

- 位置：`app/api/mobile/location/batch/route.ts:93`
- 现象：在 `db.transaction(async (tx) => ...)` 内部调用 `getCustodyProfileForUser(actor.id)`，而该函数在 `lib/custody-checkin.ts:153-157` 里用的是**全局** `db.update(persons)`，不是传入的 `tx`。
- 影响：
  1. 原子性丢失——外层事务回滚时，这次 `update(persons)` 已经提交。
  2. 连接放大——外层事务已占用一条池连接，内层再向 `poolMax=20` 的池借第二条；并发批量上报时可自锁或耗尽连接池。
- 建议：`getCustodyProfileForUser` 增加可选 `tx` 参数并全程透传；或把该调用移到事务外。

### H6. `predev` 自动清理脚本的安全守卫有两处写错

- 位置：`scripts/clean.mjs:112-117`（`withinAllowed`）、`:38`（端口白名单）、`:253`（`rmSync` 真正删除）
- 现象：
  ```js
  const insideRepo = !resolve(path).startsWith("..") && resolve(path).startsWith(repoRoot)   // :113
  const insideGradleHome = resolve(path).startsWith(join(home, ".gradle")) && resolve(path) !== home  // :115
  ```
  1. `startsWith(repoRoot)` 缺路径分隔符：`C:\...\CustodySim-old` 这类同级兄弟目录会被判为"在仓库内"。
  2. 第二个条件应为 `resolve(path) !== join(home, ".gradle")`，却和 `home` 比较，等于让 `~/.gradle` 本身也通过白名单。
  3. `:38` 的 `ports: [3000, 3100]` 是"有 dev server 在跑就别删"的唯一判据，但实际 E2E/dev 用 3102（见 `docs/web-performance.md:49`）、`playwright.config.ts:59` 回退 3000。用 3102 起 dev 时，`pnpm dev` 的 `predev` 会认为"没人在用"而删掉正在写入的 `.next`。
- 现状缓解：`SCOPES` 里的 targets 全是 `join(repoRoot, ...)` 硬编码子目录（`:39-65`），所以第 1、2 条目前**不可触发**，属纵深防御失效；第 3 条**可实际触发**。
- 建议：`startsWith(repoRoot + path.sep)`；比较对象改为 `join(home, ".gradle")`；端口判断改为从配置读，或直接探测 `.next` 目录的写入锁/最近 mtime。

---

## 2. 中危（15 条）

### M1. IP 解析缺失使限流退化为全站共享桶

- `lib/request-ip.ts:6` — `if (!trustProxy) return null`。生产未设 `TRUST_PROXY=true` 时 IP 恒为 `null`。
- `lib/security-mail-server.ts:95-96` — `reserveLimit(tx, \`${kind}:ip\`, ip || "unknown", ...)`，于是**所有用户共用一个 `unknown` 桶**。任意一人耗尽配额即可让全站邮箱验证码不可用。
- 反向风险：`lib/request-ip.ts:7-8` 开启后直接采信 `x-real-ip`，若前置代理不覆写该头，IP 限流可被任意伪造绕过。
- 建议：启动时校验"生产必须显式配置 TRUST_PROXY"，或改用代理链最右侧可信跳。

### M2. 登录成功清零本 IP 的失败计数

- `lib/login-rate-limit.ts:120-122` — `clearLoginFailures` 同时删除"账号键"和"网络键"（调用点 `app/api/auth/login/route.ts:136`、`app/api/auth/mfa/verify/route.ts:106-108`）。
- 影响：攻击者每猜 N 次就用自己的有效账号登录一次，把本 IP 的失败计数清零 → 按 IP 的横向防暴破（换账号猜）完全失效。按账号 5 次/15 分钟仍有效，故定中危。

### M3. refresh token 无「重用即吊销」检测

- `lib/refresh-token-server.ts:53` — `if (!row || row.revokedAt || row.expiresAt <= new Date()) return null`
- 旧令牌被第三方使用时直接拒绝，不吊销同 `userId` 的令牌族、不告警。令牌窃用只能靠"两人同时刷新撞车"偶然发现。

### M4. CSP 自我削弱两处

- `proxy.ts:41` — `script-src 'self' 'nonce-...'` 同时保留 `'self'`。有 nonce 时保留 `'self'` 等于允许同源任意 URL 脚本，nonce 的反 XSS 价值大幅下降。同源又存在大量用户内容下载路由（如 `/api/library/[id]/file`）。（注意：`:43` 的 `style-src 'unsafe-inline'`、`:34` 开发/腾讯地图的 `'unsafe-eval'` 属于有注释的取舍，不必改。）
- `proxy.ts:18` — `new URL(\`${request.nextUrl.protocol}//${request.headers.get("host") ?? ...}\`)` 用请求 Host 头拼 `connect-src`，Host 可伪造即向 CSP 注入任意源。应改用 `APP_ORIGIN` 白名单。

### M5. pm2 环境变量覆盖顺序错误

- `ecosystem.config.cjs:45-50`
  ```js
  env: { NODE_ENV: "production", TZ: "Asia/Shanghai", PORT: 3000, ...loadEnvLocal() }
  ```
- spread 在最后 → `.env.local` 里的 `PORT` 或 `NODE_ENV` 会**静默覆盖**生产值。`NODE_ENV` 被覆盖为非 production 时，HSTS(`proxy.ts:72`)、cookie Secure(`lib/auth-cookie.ts`)、`instrumentation.ts` 的分支、`lib/db/index.ts:8` 的 fail-fast 全部退化。
- 建议：`...loadEnvLocal()` 放最前，`NODE_ENV/TZ/PORT` 放最后。

### M6. 多个列表接口无上限 / 无分页

| 位置 | 问题 |
| --- | --- |
| `lib/checkin.ts:1018` | 补卡审核队列，`status=ALL` 时无 `limit`，一次拉全部历史 |
| `app/api/admin/persons/route.ts:77` | 未传分页参数时走无 `limit` 分支，直接返回整张 `persons` |
| `app/api/admin/prisoner-numbers/route.ts:17` | 全量返回所有在押人员 |
| `app/api/chat/conversations/route.ts:215` | `where(status = "ACTIVE")` 无 `limit`，随后用这批 id 做多表 `inArray` |
| `app/api/makeups/route.ts:52` | 被监管人分支无分页，与同文件上方风格不一致 |

### M7. 评分周结 N+1 与逐单事务

- `lib/scoring.ts:464` — `for (const user of supervisedUsers)` 内对每人 3~5 次独立查询；`:459` 的用户列表无 `limit`。
- `lib/scoring.ts:739` — `for (const order of activeOrders) await ensureIsolationReflectionTask(...)`，每个禁闭单各开一次 `db.transaction`（`:633`），N 单 = N 次连接借还。

### M8. GLM 审查并发上限可能超过连接池

- `lib/glm-review-concurrency.ts:15` — 上限读 `GLM_REVIEW_MAX_CONCURRENCY`，注释允许到 **50**。
- `:33` — 用 `dbPool.connect()` 独占一条连接挂 session 级 `pg_try_advisory_lock`，而 `lib/db/index.ts:19` 的 `poolMax` 默认 **20**。
- 后果：并发调高即饿死连接池；且 `statement_timeout: 15s` 对"连接空闲挂着锁"这种用法不生效。

### M9. 内部异常原文回传客户端

- `app/api/library/[id]/document/route.ts:82`、`app/api/library/[id]/content/route.ts:38`
  ```ts
  return failure("VALIDATION_ERROR", error instanceof Error ? error.message : ...)
  ```
- EPUB/DOCX 解析器的报错会带 zip 结构、文件路径等信息。应改为通用文案 + 服务端日志。

### M10. `reset-mfa.mjs` 可在生产库上静默执行

- `reset-mfa.mjs:27` — 护栏只判 `NODE_ENV === "production"`；而推荐用法 `node --env-file=.env.local reset-mfa.mjs <用户名> --apply` **不设置** `NODE_ENV`。指向生产 `DATABASE_URL` 时会直接 `delete from mfa_factors`（`:81-84`），绕过双因素。
- 建议：改为要求显式 `--yes-production` 之类的二次确认，或校验 DATABASE_URL 的 host 白名单。

### M11. `deploy.sh` 不先定位仓库根

- `deploy.sh:3` 起全程相对路径（`public/`、`.next/`、`ecosystem.config.cjs`），却没有先 `cd`（对比 `scripts/deploy.sh:14` 的正确做法）。从其他目录调用会让 pm2 用错误 cwd 解析 `ecosystem.config.cjs:42` 的 `.next/standalone/server.js`。

### M12. `playwright.scoring.config.ts` 丢掉了 realtime 服务

- `playwright.scoring.config.ts:19` 用单个对象覆盖了 base 的 `webServer` **数组**（`playwright.config.ts:94-100` 同时起 Next + realtime:3001）。于是 `scoring-browser.spec.ts` / `security-browser.spec.ts` 在无 3001 实时服务的环境下跑。

### M13. 端口约定三处不一致

- `playwright.config.ts:59` 回退 `3000`
- `scripts/clean.mjs:38` 守卫 `3000/3100`
- `docs/web-performance.md:49` 记录实际用 `3102`
- `playwright.scoring.config.ts:8` 用未解码的 pathname 校验，而 base `playwright.config.ts:35` 用了 `decodeURIComponent`。

### M14. `test:e2e:business` 永远跑不到自己的目标库

- `vitest.business-e2e.config.mts:2` 继承 `vitest.scoring-e2e.config.mts`，后者在**配置加载期**就把 `process.env.DATABASE_URL` 改写为 `custodysim_e2e`（`vitest.scoring-e2e.config.mts:15`）。
- 结果：`pnpm test:e2e:business` 的命名与实际行为不符。CI（`.github/workflows/ci.yml:24-25`）里因 `E2E_DATABASE_URL` 恰好指向同一个库而掩盖了这个问题。

### M15. 可以删掉最后一名管理员

- `app/api/admin/users/[id]/route.ts:120` — 只拦 `id === actor.id`（不能删自己），未保护"最后一名管理员/其他管理员"。任一管理员可删光其余管理员。

---

## 3. 低危 / 卫生（18 条）

| # | 位置 | 问题 |
| --- | --- | --- |
| L1 | `scripts/test-clean-guard.mjs` 等 | 三个安全回归脚本未被 `package.json` 任何 script 引用，只在 CI 跑（`ci.yml:41-43`），本地 `pnpm test` 覆盖不到 `clean.mjs` 这种自动删除逻辑 |
| L2 | `components/shared/api-client.ts:15` | 无 `signal`/超时，30s 轮询叠加慢接口会无限堆积；`:27` 的 ZodError 经 `error.message` 直接弹给用户 |
| L3 | `components/library/book-reader.tsx:106` | effect 清理函数里调用 `tick()`，卸载后仍 `setLiveMillis`；`:85` 用 `useState(book.seconds)` 冻结初值，切书后累计起点不更新 |
| L4 | `components/tasks/task-workspaces.tsx:130` | `useEffect(() => setDraft(written), [written])` 用 state 镜像 prop，与 `:187-197` 的 IME `composing` 逻辑叠加会覆盖正在输入的草稿 |
| L5 | `components/tasks/task-workspaces.tsx:149` | 成片 `<Label>` 无 `htmlFor`，对应 `Textarea`(`:185`) 无 `id`；全仓 104 个 tsx 仅 15 个用 `htmlFor` |
| L6 | `components/profile-forms/profile-form-manage.tsx:331`、`components/report-template-manage.tsx:264,545` | 可增删列表用 `key={index}`，删除中间项时 Select/焦点状态错位 |
| L7 | `components/shared/marquee-banner.tsx:32` | `ResizeObserver` 观测的是 `shouldScroll` 翻转前分支的节点，effect 只依赖 `[text]`，切换后观测目标已脱离文档 |
| L8 | `lib/db/migrations/` | 目录下只有空的 `meta/`，从无 drizzle generate 产物。schema 唯一真相是 `lib/db/schema.ts`(1666 行)，生产结构靠 8 个手写 `lib/db/upgrades/*.sql` + `scripts/upgrade-*.mjs` 维护 → 漂移风险 |
| L9 | `drizzle.config.ts:10` | `process.env.DATABASE_URL ?? ""`，生产漏配时拿空串而非快失败，与 `lib/db/index.ts:8` 的 fail-fast 策略相反 |
| L10 | `.gitignore` | `artifacts/` 累计 **3.6 GB / 23935 文件**（Android 构建产物，含 8994 个 `.class`、3281 个 `.dex`），但只忽略了其中 4 个子目录（`episteme-upstream`、`app-split-history` 等），其余仍暴露给 git；`.next-e2e/`、`.codex-vitest-tmp/` 未忽略 |
| L11 | `.codex-vitest-tmp/` | 仓库内的临时目录，含 `makeup-playwright.config.ts`（重写 `webServer` 命令并追加 `--webpack`）。被 `tsconfig.json` 的 `**/*.ts` 收录进类型检查 |
| L12 | `.env.example` | 声明了 `GLM_API_KEY`、`ZAI_API_KEY`，全仓 `process.env` 无任何引用（GLM 相关实际走 DB 配置） |
| L13 | `lib/guard.ts` | 全仓无引用（`requireRole` / `ForbiddenError` 未被 import），死代码 |
| L14 | `app/api/audit-logs/route.ts:40` | 唯一没有 `try/catch` 的列表接口，DB 报错变成裸 500，与其余路由 `failure("INTERNAL_ERROR")` 不一致 |
| L15 | `lib/db/index.ts:35` | `if (NODE_ENV !== "production") globalForDb.custodySimPool = pool` — 生产不缓存池，若模块被多份 bundle 重复求值会各自 `new Pool({max:20})`，与注释里"50 连接要留余量"的假设冲突 |
| L16 | `lib/auto-review-server.ts:98,222` | 循环内逐条重新 `getAutoReviewSettings()`，每行一次额外 DB 读 |
| L17 | `app/api/admin/orgs/sort/route.ts:13` | `items` 只有 `.min(1)` 没有 `.max(...)`，`:24` 在单事务内 `Promise.all(items.map(update))`，可被塞入任意多条 UPDATE |
| L18 | `lib/custody-checkin.ts:127` | 每次同步羁押状态都拉该用户**全部**已批准申请（无 `limit`、无时间过滤），而它被 `getCustodyProfileForUser` 在每个位置上报点里调用 |

---

## 4. 已核实为「无问题」，不必再查

以下是我专门验证过、结论是**没有问题**的点，避免重复劳动：

- **无 SQL 注入**：全仓无 `sql.raw`；31 处 `sql\`\`` 全是参数化占位；游标 `cursorId` 在 audit-logs / notices / reviews 都先过 `UUID_PATTERN` 白名单；`orderBy` 全部写死列名。
- **令牌不落 localStorage**：全仓 0 命中。cookie 统一 `httpOnly + sameSite:"lax" + secure`（`lib/auth-cookie.ts:19-25`）。
- **没有"仅前端校验角色"**：`app/(dashboard)/layout.tsx:13`、`app/(supervisor)/layout.tsx:13`、`app/(supervised)/layout.tsx:13` 均在服务端 `redirect(getRoleHome(...))`；敏感 API 逐个校验角色/监管范围（如 `lib/supervision-scope.ts:181-199`）。
- **中间件无绕过缺口**：`proxy.ts:119` matcher 为 `/:path*`，无大小写/尾斜杠白名单。
- **限流不是内存 Map**：基于 DB + `pg_advisory_xact_lock`（`lib/login-rate-limit.ts:38-41`），账号键做了 `toLowerCase` 归一。
- **无账号枚举时序差异**：登录失败做等成本 bcrypt（`lib/auth.ts:43-46` + `app/api/auth/login/route.ts:69-72`）；MFA/邮箱验证码均有尝试上限，恢复码一次性消费；TOTP/HMAC 比较用 `timingSafeEqual`。
- **无硬编码密钥/默认口令**：MFA 种子用 AES-256-GCM 加密且生产强制独立密钥（`lib/mfa.ts:18-25`）；媒体 permit 与 `AUTH_SECRET` 强制分离（`lib/edgeone-media.ts:24-25`）。
- **未鉴权的 route 都是合理委托**：扫描出 10 个 route 不直接引用鉴权函数，逐个确认都是转发（如 `app/api/community/posts/route.ts` → `lib/community-server.ts`、`app/api/checkins/my/route.ts` → 转发 `../route`、`pdf-assets`/`pdf-worker`/`server-info` 为公开静态资源）。

---

## 5. 若只修 5 项（按投入产出排序）

1. **H1** 补 `error.tsx` / `global-error.tsx` / `loading.tsx` —— 半天内完成，几乎零风险，收益最大。
2. **H4** `request.json()` 全量补 `.catch(() => null)` —— 纯机械替换，可脚本化，立刻消灭一整类 500。
3. **H3** `ensureUserTasks` 加时间窗缓存 + 开书路径去同步调用 —— 消除最热的性能债。
4. **H2** 空会话下 `message.created` 兜底刷历史页 —— 一处 if 分支，修掉用户可见的"消息不出现"。
5. **M5** `ecosystem.config.cjs` 调换 spread 顺序 —— 一行改动，消除生产环境被 `.env.local` 静默改坏的整类事故。

修复时请注意：本项目 CI 会把 `lint`、`typecheck`、单测、Playwright、scoring 与 business e2e、`next build` 全部跑一遍（`.github/workflows/ci.yml`），任何改动都应能通过这些门禁。
