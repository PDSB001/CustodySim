# 开发与测试

面向需要修改代码或运行测试的开发者。只想登录使用系统，请阅读[使用指南](user-guide.md)。完成本页后应能同时打开本地 Web 和聊天实时服务，并知道哪些测试会写数据库。

## 初始化

项目声明 Node.js >= 20.9.0，包管理器锁定 `pnpm@12.4.2`。使用支持该 pnpm 版本的 Node 环境，不同时生成 npm/yarn 锁文件。

```bash
node --version
pnpm --version
pnpm install --frozen-lockfile
```

复制 `.env.example` 为 `.env.local`（PowerShell：`Copy-Item .env.example .env.local`；Bash：`cp .env.example .env.local`），填写已创建的独立开发数据库和密钥，见[配置参考](configuration.md)。不要覆盖已有私有配置。

```bash
pnpm db:push
```

此命令同步结构，会写数据库，执行前确认是开发库。初始管理员通过临时设置 `INITIAL_ADMIN_USERNAME` / `INITIAL_ADMIN_PASSWORD` 后运行 `pnpm db:bootstrap-admin` 创建，使用后清除临时凭据。已有管理员会拒绝重复初始化，首次登录在 Web 完成改密。

演示数据只能在非生产环境显式设置 `ALLOW_DEMO_SEED=true` 后运行 `pnpm db:seed`。

## 启动两个服务

终端一执行 `pnpm dev`；终端二执行 `pnpm dev:realtime`。只启动 Web 不会启动实时服务。

Web 监听 `0.0.0.0:3000`，实时服务默认端口 3001。浏览器联调在 `.env.local` 设置 `NEXT_PUBLIC_CHAT_REALTIME_URL=http://localhost:3001`，修改后重启 Web。手机访问时将 localhost 换成开发机局域网 IP，并允许防火墙通过两个端口。HTTP 联调可设 `AUTH_COOKIE_SECURE=false`，HTTPS 生产保持 true。

Android 使用独立的编译期地址，见[Android 指南](android-development.md)。

## 检查命令

| 命令                            | 内容                               | 数据库                             |
| ------------------------------- | ---------------------------------- | ---------------------------------- |
| `pnpm lint`                     | 受维护 TS/JS 源码，零警告规则      | 不需要                             |
| `pnpm typecheck`                | TypeScript 类型检查                | 不需要                             |
| `pnpm test` / `pnpm test:watch` | 单元测试 / 监听                    | 不需要                             |
| `pnpm build`                    | 生产构建                           | 需有效配置，页面构建可能访问数据库 |
| `pnpm test:e2e`                 | Playwright 登录与业务入口          | 独立测试库                         |
| `pnpm test:e2e:scoring`         | 积分集成与浏览器场景               | 独立测试库                         |
| `pnpm test:e2e:business`        | 业务数据库集成                     | 独立测试库                         |
| `pnpm test:all`                 | 静态、类型、单元及上述三组集成检查 | 独立测试库                         |

设置 `E2E_DATABASE_NAME=custodysim_e2e`，或用 `E2E_DATABASE_URL` 指向独立实例，再运行 `pnpm db:setup-e2e`。初始化需要创建数据库的权限；首次安装浏览器运行 `pnpm exec playwright install chromium`。

E2E 默认使用 3100 端口，可用 `E2E_BASE_URL` 覆盖。测试包含真实写入，禁止指向业务库；完整场景见[业务测试](../e2e/business/README.md)和[积分测试](../e2e/scoring/README.md)。

## 修改入口

`app/api/` 为 HTTP 接口，`lib/` 为鉴权、领域规则和数据库访问，`components/` 为 Web UI，`realtime-server.mjs` 为 Socket.IO 服务，`scripts/` 为维护工具，`android/` 为客户端。修改 Next.js 代码前按根目录 AGENTS.md 阅读 `node_modules/next/dist/docs/` 中对应版本指南。
