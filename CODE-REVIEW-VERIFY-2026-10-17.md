# 修复批次独立复验报告（2026-10-17）

- 复验对象：`CODE-REVIEW-2026-10-17.md`（原报告）+ `CODE-REVIEW-REMAINING-2026-10-17.md`（交接）+ `docs/code-review-follow-up-2026-10-17.md`（逐项记录）
- 复验方式：**只读**。跑门禁、读 diff、核对类型定义与运行时行为，未修改任何代码
- 基线：`HEAD = d43168a`，工作区有 **93 个文件未提交**（+649 / −270）
- 重要：**下文所有行号都基于"`d43168a` + 当前未提交工作区"。一旦提交或继续改动，行号会漂移，请以符号名（函数名/常量名）为准重新定位。**

---

## 一、结论摘要

这批修复整体质量高，**没有发现"修坏了"的项**。原报告的高危 6 条全部落地，且修法不是敷衍（例如 H5 是把 `tx` 全程透传，而不是把调用挪到事务外；H2 补的是真 socket 浏览器回归，不是只改 if 分支）。

复验中确认成立的有 9 项，需修正技术表述的 3 项，文档未覆盖的 2 项，本次改动**新引入**的 1 个配置陷阱。

最需要立刻处理的事不是代码，而是：**93 个文件的修复和两份交接文档都还没进版本库**，丢一次就全没了。详见第六节。

---

## 二、独立复验结果

以下全部在当前工作区实跑，可复现。

| # | 复验项 | 方法 | 结果 |
| --- | --- | --- | --- |
| 1 | 类型检查 | `npx tsc --noEmit --incremental false` | **通过**，无输出 |
| 2 | Lint | `npx eslint . --max-warnings 0` | **通过**，exit 0 |
| 3 | 单元测试 | `npx vitest run` | **58 个测试文件全部通过** |
| 4 | H4 `request.json()` 覆盖率 | 脚本遍历 `app/api/**/route.ts`，检查 `request.json()` 后是否紧跟 `.catch` | **68 处 / 68 处带 catch，0 遗漏** |
| 5 | H1 错误边界 | 递归查找 `error.tsx` / `global-error.tsx` / `loading.tsx` | `app/error.tsx`、`app/global-error.tsx`、`(dashboard)` `(supervised)` `(supervisor)` 各一套 error+loading，**齐全** |
| 6 | `retry()` API 真实性 | 读 `node_modules/next/dist/client/components/error-boundary.d.ts` | 类型中确有 `reset: () => void` 与 `retry: () => void`，**文档说法成立**（本版 Next 与常见版本不同，此项值得复核） |
| 7 | L12 是否为误判 | 读 `lib/glm-review-config.ts` | **确为原报告误判**。`apiKeyVariable` 由 provider 决定，`apiKey: env[apiKeyVariable]`，`GLM_API_KEY` / `ZAI_API_KEY` 都在用，不能删 |
| 8 | H6 / M13 清理脚本 | 读 `scripts/clean.mjs` diff | 已重写：改用 `realpathSync` + `relative` + `sep` 做边界判定，拒绝仓库根与 Gradle 根；端口白名单加入 `3102` 与 `PORT` / `E2E_BASE_URL` 推导 |
| 9 | L10 / L11 仓库卫生 | 读 `.gitignore`、`tsconfig.json` diff | `.gitignore` 已加 `/artifacts/`、`/.next-e2e/`、`/.codex-vitest-tmp/`；`tsconfig` 已同步 exclude 三项 |

顺带确认的修改方向正确的项：

- **H5**（事务逃逸）：`lib/custody-checkin.ts` +27 行，是把查询/同步/更新全程透传 `tx`，方向正确。
- **H3**（任务引擎）：抽出 `loadTaskContext(userId?)`，单用户路径用 `eq(users.id, userId)` 收窄，调度路径一次快照复用。改法与文档描述一致。
- **M2**（登录限流）：成功登录只清账号键，保留网络桶。
- **M5**（pm2 env）：`...loadEnvLocal()` 已移到最前，`NODE_ENV/TZ/PORT` 在后。
- **M10**（reset-mfa）：改为必须确认实际数据库名，缺确认时不连接。
- **M15**（管理员互删）：加了事务级成员锁与最后有效管理员保护。
- **L9**（drizzle）：`DATABASE_URL` 缺失时 `throw`，不再用空串兜底。

---

## 三、需要修正的 3 处技术表述

这 3 条不是"代码错了"，是**记录错了**。记录错了同样危险：下一个人会按错误原因去改，或者以为某个问题已经被顺带修掉。

### 3.1 M4 的结论正确，但理由归错了

`docs/code-review-follow-up-2026-10-17.md` 第 17 行写：

> M4 | nonce 增加 strict-dynamic。报告所述生产 Host 注入不成立：生产未配实时 URL 时不添加源，已配置时使用配置值。

后一句是对的，但**它与 `strict-dynamic` 是两个不相干的问题**。真正的依据在：

```12:13:proxy.ts
const configured = process.env.NEXT_PUBLIC_CHAT_REALTIME_URL
if (!configured && process.env.NODE_ENV === "production") return ""
```

生产环境要么用配置值拼源，要么返回空串，**永远走不到读 `Host` 头那一行**。`Host` 分支只在开发环境生效（`:20` 的 `url.port = "3001"` 也只可能发生在开发）。

建议把这条记录改成两句独立的话：

- 原报告 M4 前半（`'self'` 削弱 nonce）→ 已用 `strict-dynamic` 处理；
- 原报告 M4 后半（Host 注入）→ **生产不成立**，原因是 `proxy.ts:12-13` 的 production 提前返回，与 `strict-dynamic` 无关。

否则下一个人可能认为"改 CSP 顺带解决了 Host 注入"，从而不再检查 `getRealtimeConnectSources`。

### 3.2 `strict-dynamic` 会让 `https://map.qq.com` 白名单失效

```38:42:proxy.ts
return [
  "default-src 'self'",
  // Tencent Maps GL currently requires eval internally for its WebGL runtime.
  `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${allowsUnsafeEval ? " 'unsafe-eval'" : ""}${usesLibrary ? " 'wasm-unsafe-eval'" : ""} https://map.qq.com https://*.map.qq.com`,
  usesTencentMap ? "worker-src 'self' blob:" : "worker-src 'self'",
```

按 CSP3 规范，**支持 `'strict-dynamic'` 的浏览器会忽略 `'self'` 和域名白名单**。也就是说 `https://map.qq.com` 这串在 Chrome 52+ / Firefox 52+ / Safari 15.4+ 上已经是死配置。

当前实现**理论上仍然可用**：腾讯地图 SDK 由代码动态注入——

```52:57:components/electronic-fence/tencent-fence-map.tsx
  if (sdkPromise) return sdkPromise
  sdkPromise = new Promise<TencentMapApi>((resolve, reject) => {
    const script = document.createElement("script")
    script.src = `https://map.qq.com/api/gljs?v=1.exp&key=${encodeURIComponent(key)}`
    script.async = true
```

`strict-dynamic` 的语义是"由受信任（带 nonce）脚本动态创建的脚本自动受信任"，所以 SDK 能加载。**但这依赖两个前提**：

1. Next 的 chunk `<script>` 确实带上了 nonce（依赖 `proxy.ts:109-111` 把 CSP 写进 request headers，以及 `app/layout.tsx:16` 读到 `x-nonce`）；
2. 该页面没有任何"静态 `<script src="https://map.qq.com/...">`"引入方式。

前提 2 目前成立。但这类改动的失败方式是**生产环境特定浏览器白屏**，本地 dev 因为 `allowsUnsafeEval` 更宽松而看不出来。

建议：在 CI 里加一条廉价保险——跑电子围栏页时监听 `securitypolicyviolation` 事件，断言计数为 0。比事后排查白屏便宜得多。

### 3.3 M8 的修复引出一个静默停摆的配置陷阱（本次新引入）

修复后的预算计算：

```js
function connectionBudget(env) {
  const poolMax = Number(env.DATABASE_POOL_MAX) || 20
  // All models together may pin at most a quarter of the pool, capped at five.
  return Math.max(0, Math.min(5, Math.floor(poolMax / 4)))
}
```

`DATABASE_POOL_MAX` 默认 20 → budget = 5，正常。但如果运维为了给 realtime 进程让连接，把它调到 **≤ 3**，则：

1. `connectionBudget` 返回 `0`；
2. `getGlmReviewConcurrencyLimit` 被压成 `0`；
3. `acquireGlmReviewConcurrencySlot` 首行 `if (!limit || ...) return null`；
4. 调用方只做了一次 `break`：

```113:116:lib/auto-review-server.ts
const releaseSlot = prepared.decision
  ? null
  : await acquireGlmReviewConcurrencySlot(config)
if (!prepared.decision && !releaseSlot) break
```

**全程没有日志**。线上表现是"自动审核不再领取任何待审记录"，提交**仍然保持待审状态**，不会被误判为通过或退回；运维既看不到错误，也查不到原因，只能靠读代码推测。请注意这里不是"自动转人工"——`prepared.decision` 为 null 且拿不到槽位时是直接 `break`，本轮一条都不领取，记录原样留在待审队列里等人处理。

建议补三件事（都不大，且**不能让网站启动失败**）：

- `break` 之前先判断 `limit === 0`，打一条 `console.warn`（同一原因只需打一次），说明"已暂停领取待审记录，记录仍待审"；
- 在管理端 `GET /api/admin/auto-review` 的响应里暴露容量状态与原因，让配置页直接看见"为什么审核不动了"；
- **不要**在模块加载时 `throw`。这是配置问题，不应把整个站点带崩；启动期只能静默降级，把原因留给管理页和日志。

---

## 四、交接文档未覆盖的 2 点

### 4.1 错误页绕过了项目 UI 体系

`app/error.tsx` 只是转出：

```tsx
"use client"

export { default } from "@/components/shared/route-error"
```

真正实现在 `components/shared/route-error.tsx`：

```tsx
<button
  type="button"
  onClick={retry}
  className="rounded border px-4 py-2"
>
  重新加载
</button>
```

问题：

- 用的是 Tailwind 裸类，没有走 `components/ui/button`，因此**缺 `focus-visible` 环、缺 hover 态、无 dark mode 适配**；
- 错误页是故障时用户唯一能看到的界面，它的对比度和键盘可见性恰恰最该保证；
- 这些 `error.tsx` 都是 `"use client"` 组件，**不能导出 `metadata`**（`metadata` 只在 Server Component 中生效）。若要给标签页设置标题，应在组件内渲染 `<title>`，由 React 19 提升到 `document.head`；`app/global-error.tsx` 因为要自己渲染 `<html>`，已经手写了 `<title>`，两处应采用同一文案。

建议：换成项目内的 Button 组件，或至少补齐 `focus-visible:ring-2` 与暗色类。

### 4.2 交接文档本身正在快速失效

`CODE-REVIEW-REMAINING-2026-10-17.md` 第 8 行明确要求：

> **本轮安全修复和 AI 审核标准调整尚未提交推送。必须同时查看当前工作区/补丁，不能只看 GitHub 上的 HEAD。**

这句话准确，但它描述的是一个**高危状态**：

- 93 个文件、+649/−270 行的修复全部悬在工作区，`HEAD` 停在 `d43168a`；
- 风险主要来自**丢弃操作**：`git checkout -- .`、`git restore .`、IDE 里误点 "Discard Changes"，以及误判的 `git stash drop`。`git stash` 本身不会丢失改动，它会把工作区内容存进 stash 栈，可以随时 `git stash pop` 取回——所以不要把"stash"当成危险动作，真正危险的是没有 stash 记录的原地覆盖；
- 两份交接 md 和 `docs/code-review-follow-up-2026-10-17.md` 里，前者未跟踪，后者也未提交——**"哪些是误判、为什么这样修"的判断依据和代码一起暴露在同一个风险面上**；
- 下一个接手的人如果只看 GitHub，会得出与原文档完全相反的结论（以为 6 条高危都还在）。

---

## 五、其他观察（低优先级，供参考，不建议本轮动）

| 位置 | 观察 | 判断 |
| --- | --- | --- |
| `lib/db/index.ts` | 改为无条件 `globalForDb.custodySimPool = pool` | 修掉了"生产多份 bundle 各自建池"的隐患。代价是**同进程内**改 `DATABASE_URL` 会复用旧池。当前 `scripts/` 都是独立进程、vitest 配置在模块加载期设 env，所以暂无风险；若将来写"同进程切库"的测试需注意 |
| `components/workspaces/role-workspace.tsx` | 用 `useSyncExternalStore` 门控 hydration，并把查询结果重包装成新对象 `{ data: hydrated ? ... }` | 意图正确（消除 streamed segment 的 hydration mismatch），但每次 render 都会产生新对象引用。若日后这些对象被传给 `memo` 组件或进入 effect 依赖，会引入额外渲染。建议留意，不必现在改 |
| `lib/glm-review-concurrency.ts` | `slotState` 是**进程内**计数，pg advisory lock 是**跨进程**的 | 两者职责不同，不要混为一谈：**模型并发上限由 `pg_try_advisory_lock(namespace, slot)` 跨进程保证**，多实例部署时同模型的总并发仍然是 `limit`，不会变成"实例数 × limit"。`slotState` 只限制"本进程最多占用 budget 条池连接"，所以**连接**总占用是 `实例数 × budget`，多实例时需单独核算连接预算，而不是重算并发 |
| `lib/glm-review-concurrency.ts` | `release` 闭包有 `released` 幂等标志，所有失败路径都归还槽位 | 这一点做得好，`auto-review-server.ts` 的 4 条 `releaseSlot?.()` 分支覆盖完整，未发现计数泄漏 |

---

## 六、建议的执行顺序

与原交接文档的建议顺序有一处调整，理由写在后面。

1. **先存档，再继续**（零成本，优先级最高）
   - `git add -A` 后提交（消息建议按修复批次拆分，便于日后 bisect）；
   - 若暂时不想提交，至少 `git diff > backup-2026-10-17.patch`，并 `git add -N` 把三份 md 纳入索引；
   - 提交后回写三份文档里的行号，或统一改成"以符号名为准"。

2. **M6 分页（提前到第一位做）**
   - 原文档把分页排在 H3 之后。建议提前：它是唯一"随运行时间必然恶化"的项，且需要同步改独立 Android 仓库，**协调成本远高于代码成本**，启动得越晚，需要兼容的已发布客户端版本越多。

3. **补 CI 的 CSP 违规断言**（配合 `strict-dynamic` 上线）
   - 一条 `securitypolicyviolation` 计数断言，覆盖电子围栏页与普通页。

4. **H3 定向查询 + M7 批量聚合**
   - 纯后端优化，可随时插入，不阻塞他人；两者都应先加查询次数/耗时计数，再改。

5. **L18 / M3 单独排期**
   - 同意原文档的判断：羁押有效期需要"可索引有效期字段 + 回填"，令牌族需要"familyId + 并发刷新语义"，都不能机械改。

---

## 附录：复验命令

```powershell
cd c:/Users/jxy/Documents/CustodySim

# 门禁
npx tsc --noEmit --incremental false
npx eslint . --max-warnings 0
npx vitest run

# H4 覆盖率（request.json 是否都带 catch）
node -e "const fs=require('fs'),p=require('path');let t=0,c=0,m=[];const w=d=>{for(const e of fs.readdirSync(d,{withFileTypes:true})){const f=p.join(d,e.name);if(e.isDirectory())w(f);else if(e.name==='route.ts'){const s=fs.readFileSync(f,'utf8');const re=/request\.json\(\)/g;let x;while((x=re.exec(s))){t++;if(/^\.catch/.test(s.slice(x.index+x[0].length)))c++;else m.push(f)}}}};w('app/api');console.log(t+'/'+c,'missing:',m)"

# 错误边界清单
Get-ChildItem -Recurse app -Include error.tsx,global-error.tsx,loading.tsx

# retry API 是否真实存在
Select-String -Path node_modules\next\dist\client\components\error-boundary.d.ts -Pattern 'retry'
```
