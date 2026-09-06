# 账号与申请流程回归

```sh
pnpm db:setup-e2e
pnpm test:e2e:business
```

复用积分测试的数据库隔离配置，强制使用 `custodysim_e2e`。使用真实 JWT、密码哈希、Route Handler 与 PostgreSQL；仅适配 Next.js 的 Cookie 上下文。随机测试账号及其业务数据会在结束后清理。

- 通过真实数据库行锁让两个改密请求同时验证旧密码，验证只有一个成功、另一个返回 409，且旧 JWT 失效。
- 注入审计写入失败，验证申请提交连同审批队列一起回滚，重试只创建一份申请。
- 验证审批审计失败时审批记录、申请状态和印章一起回滚，重试正常成功，重复审批返回 409。

日期有效性另由 `lib/__tests__/shanghai-datetime.test.ts` 验证，覆盖不存在的日期、合法闰日和 ISO 时区转换。
