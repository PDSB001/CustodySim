# 业务数据库回归

核对日期：2026-10-18。

```bash
pnpm db:setup-e2e
pnpm test:e2e:business
```

使用真实 PostgreSQL、JWT、密码哈希、Route Handler 与业务事务，适配 Next 请求 Cookie 上下文；外部模型/邮件等使用受控替身，不发送真实业务内容。

## 隔离与执行

只允许 custodysim_e2e，拒绝与业务连接重用，执行前核对 current_database()。E2E_DATABASE_URL 优先，否则从本机配置派生；初始化写结构和演示数据。

测试创建随机账号及记录并清理自己的数据，部分调度可作用于其他演示记录。不要在业务库运行，也不要与积分/浏览器/其他数据库写测试并行。完整入口见[开发指南](../../docs/development.md)。

## 覆盖范围

| 文件                                                  | 主要验证                                           |
| ----------------------------------------------------- | -------------------------------------------------- |
| workflows.test.ts                                     | 改密并发、申请与审批事务、审计失败回滚             |
| native-auth.test.ts                                   | 原生登录、MFA、刷新轮换、停用与登出                |
| security-email.test.ts                                | 邮箱确认、限流、发送失败、撤销与防重放             |
| auto-review.test.ts                                   | 模型决策、转人工、重复扫描、配置变化、连接预算暂停 |
| review-regressions.test.ts / review-snapshots.test.ts | 审核范围、任务/补卡原因与快照                      |
| checkin-records.test.ts / location-track.test.ts      | 点名记录、定位批次与权限                           |
| edgeone-media.test.ts                                 | 签名、缓存取字节、撤权、版本与资源边界             |
| community.test.ts                                     | 匿名、可见字段、自愿分享与删除                     |
| attachments.test.ts                                   | 图片/附件校验及权限                                |
| person-list.test.ts / web-performance.test.ts         | 人员分页、游标与查询行为                           |

具体断言以各文件为准，测试数量随代码变更。通过数据库回归不等于真实浏览器、EdgeOne 节点或 Android 设备已验收。

日期边界另见 lib/**tests**/shanghai-datetime.test.ts；评分与禁闭精确时间链见[积分测试](../scoring/README.md)。
