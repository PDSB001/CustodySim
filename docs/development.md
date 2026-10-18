# 开发与测试

核对日期：2026-10-18。日常使用请看[使用指南](user-guide.md)；Android 构建在[独立 App 仓库](https://github.com/PDSB001/CustodySim-app/blob/main/docs/android-development.md)进行。

## 准备环境

仓库 CI 使用 [.node-version](../.node-version) 指定的 **Node 24**；包管理器为 **pnpm 12.14.0**。package.json 支持 Node 24 或 >=26，对齐现有 geoip-lite 与测试工具要求；联调优先与 CI 保持一致。

```bash
node --version
pnpm --version
pnpm install --frozen-lockfile
```

复制 .env.example 为 .env.local，填写独立开发库及随机密钥。Bash 用 `cp .env.example .env.local`；PowerShell 用 `Copy-Item .env.example .env.local`。已有私有配置不要覆盖。

```bash
# 仅开发/新空库；先确认连接目标
pnpm db:push
```

初始管理员使用一次性的 INITIAL_ADMIN_USERNAME / INITIAL_ADMIN_PASSWORD，执行 `pnpm db:bootstrap-admin` 后删除临时配置。已有管理员会阻止重复初始化；首次改密在 Web 完成。[配置参考](configuration.md)说明密钥和可选能力。

演示 seed 只能在非生产环境显式启用 ALLOW_DEMO_SEED=true。不要在有业务数据的库运行 seed。

## 启动 Web 与实时服务

```bash
# 终端一
pnpm dev
```

```bash
# 终端二
pnpm dev:realtime
```

Web 默认 3000，实时服务 3001。本地 .env.local 可设置 NEXT_PUBLIC_CHAT_REALTIME_URL=http://localhost:3001；改变 NEXT_PUBLIC_* 后重启或重新构建 Web。手机联调使用开发机局域网地址，两个端口都需可达，Android 在独立仓库配置私有开发端点。仅 HTTP 开发可设置 AUTH_COOKIE_SECURE=false。

`pnpm dev` 先执行缓存清理守卫；不要在另一个 Next 实例运行时强制删除 .next。生产构建与开发共用输出目录，也不要并行执行。

## 检查命令矩阵

| 命令                     | 检查内容                           | 数据库 / 进程             |
| ------------------------ | ---------------------------------- | ------------------------- |
| pnpm lint                | ESLint，零警告                     | 不需要数据库              |
| pnpm typecheck           | TypeScript 7 原生检查              | 不需要数据库              |
| pnpm test                | Vitest 单测及三组运维安全回归      | 安全回归启动隔离替身进程  |
| pnpm test:watch          | Vitest 监听                        | 不包含运维脚本            |
| pnpm test:safety         | 清理守卫、实时服务、部署流程模拟   | 不操作真实生产 PM2        |
| pnpm build               | TS7 检查 + Turbopack 生产构建      | 需要有效配置              |
| pnpm test:e2e            | 桌面/移动普通浏览器                | 隔离 Next + 实时服务      |
| pnpm test:e2e:scoring    | 积分数据库 + 评分/安全浏览器       | 串行执行两个套件          |
| pnpm test:e2e:business   | 业务 Route Handler 数据库回归      | 直接连接隔离 PostgreSQL   |
| pnpm test:e2e:production | 实际 standalone 的 CSP 浏览器回归  | 本地构建与服务，默认 3110 |
| pnpm test:all            | 静态、单测、安全、上述全部集成检查 | 按脚本顺序执行            |

## 独立测试库

测试强制使用名为 **custodysim_e2e** 的数据库。E2E_DATABASE_URL 优先；未设置时从业务连接派生服务器和凭据，再换为该库名。任意别名、与业务库相同的连接会被拒绝。

```bash
pnpm db:setup-e2e
pnpm exec playwright install chromium
pnpm test:e2e:business
pnpm test:e2e
```

初始化需要创建数据库/结构与 seed 权限，会写测试库。业务、积分、浏览器套件不可同时运行；周结扫描也会修改测试库内其他演示记录。普通浏览器默认 3100，实时服务 3001，E2E_BASE_URL 可更换 Web 地址；不复用已有开发服务。

生产 CSP 套件在构建前校验本地 HTTP 来源与 custodysim_e2e，使用受控地图 SDK 和虚构 key。Windows 启动器仅处理 standalone 内部生成目录链接。参见 [CI](ci.md)、[业务回归](../e2e/business/README.md)与[积分回归](../e2e/scoring/README.md)。

## 修改入口与文档

app/api 是接口；lib 是权限、领域规则、数据库；components 是 UI；scripts 是维护工具。修改 Next.js 代码前，按 [AGENTS.md](../AGENTS.md) 阅读 node_modules/next/dist/docs 中当前版本指南，不能照搬旧版 API。

涉及协议同时更新[原生规格](android-client.md)，涉及环境变量同步 .env.example 与[配置参考](configuration.md)。代码审查与真实模型、设备、生产验收结果分别记录。
