This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## 测试

测试分为两层，单元测试不依赖数据库，端到端测试覆盖真实登录及角色工作台路由。

| 层级       | 覆盖内容                                         | 命令                              |
| ---------- | ------------------------------------------------ | --------------------------------- |
| 单元测试   | 组织层级、编号、密码、规则周期、任务表单载荷校验 | `npx --yes pnpm@11.19.0 test`     |
| 端到端测试 | 三类角色登录、工作台跳转、管理区权限隔离         | `npx --yes pnpm@11.19.0 test:e2e` |
| 全量测试   | 依次执行上述两类测试                             | `npx --yes pnpm@11.19.0 test:all` |

端到端测试默认使用 `http://127.0.0.1:3000`。有已启动的开发服务时会复用它；否则会自行启动。首次运行若提示缺少浏览器，请执行：

```powershell
npx playwright install chromium
```

后续数据库写入、任务生成和审核流的集成测试将固定使用独立的 `custodysim_test` 数据库，不会使用 `.env.local` 的业务库。

## 本地 IP 粗略定位

打卡页关闭 GPS 时，系统通过本地 `geoip-lite` 数据库解析 IP，仅保存国家、省份、城市与时区，不保存 IP 库返回的经纬度范围，也不会把用户 IP 发给第三方定位接口。

首次部署已可使用依赖内置数据。建议注册免费的 MaxMind GeoLite2 账户后，将 `MAXMIND_LICENSE_KEY` 写入 `.env.local`；也可以用 `MAXMIND_GEOIP_CONF` 指向包含 `LicenseKey` 的 MaxMind 配置文件。随后运行：

```powershell
npx --yes pnpm@11.19.0 geoip:update
```

生产部署脚本在检测到 `MAXMIND_LICENSE_KEY` 后会自动执行更新。

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

### 手机局域网访问

开发服务会监听所有网卡。手机和电脑连接同一 Wi-Fi 后，使用终端显示的局域网地址访问，例如 `http://192.168.1.170:3000`。本地 `.env.local` 已配置 `AUTH_COOKIE_SECURE=false`，使 HTTP 局域网地址可以保存登录 Cookie。

部署到带 HTTPS 的服务器时，请删除该项或设为 `AUTH_COOKIE_SECURE=true`，保持会话 Cookie 的 Secure 属性。

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
