# 积分与禁闭回归

```sh
pnpm db:setup-e2e
pnpm test:e2e:scoring
```

仅使用独立的 `custodysim_e2e` PostgreSQL 数据库。连接参数从 `.env.local` 的业务连接派生，也可通过 `E2E_DATABASE_URL` 指定；测试配置拒绝其他库名和业务库重用，并在测试开始时查询 `current_database()` 再次确认。初始化同步结构和演示数据，测试创建随机账号并清理自己的数据。周结扫描会更新测试库内其他演示账号的数据，因此不要将该库用于业务或同时运行其他数据库测试。

`vitest.scoring-e2e.config.mts` 运行后端链路测试：使用真实 JWT、授权检查、提交与审核 Route Handler、调度器和数据库事务；仅适配 Next.js 请求 Cookie 上下文并固定 Date，以精确验证上海时间周一 00:09:59.999 / 00:10:00 边界。覆盖首次通过、退回后通过、过期与缺失流水回填、跨周双向重算、审核与补卡晚到、错误禁闭撤销、反思任务取消及幂等性。已取消检讨不可审核，也不会因过期继续扣分。

`playwright.scoring.config.ts` 启动新的 Next.js 服务，不复用现有服务，运行桌面 Chrome 与 Pixel 7 场景。通过真实登录页面和 HTTP 提交/审核接口验证跨周回填后的撤销结果；页面显示“已取消”，提交与草稿接口拒绝写入。这部分使用真实系统时间；精确的周一边界由后端链路测试覆盖。

安全回归还覆盖：使用真实 PostgreSQL 行锁阻塞提交、草稿和审核请求，在等待期间跨过截止时间后必须返回 409 且不落库；未登录、他人任务及无监管关系的审核/调分请求被拒绝；通过注入审计服务失败验证手动积分事务整体回滚，并验证恢复后积分与审计日志一起提交。

单独运行：

```sh
pnpm exec vitest run --config vitest.scoring-e2e.config.mts
pnpm exec playwright test --config playwright.scoring.config.ts
```

默认端口为 3100，可用 `E2E_BASE_URL` 更改。端口被占用时测试会失败，避免误连使用业务数据库的服务。普通 Playwright 配置排除本套用例；`test:all` 会追加本套后端与浏览器验证。
