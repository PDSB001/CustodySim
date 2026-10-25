# Web / API 脚本导航

从仓库根目录运行。部署仍使用原有入口，不因目录整理更改数据库或生产发布流程。

## 部署与排障

| 脚本                          | 用途                            | 影响                                 |
| ----------------------------- | ------------------------------- | ------------------------------------ |
| deploy.sh                     | 增量拉取、构建、升级、PM2、自检 | 写数据库、重启服务                   |
| db-health.sh                  | 校验目标库并做只读体检          | 不做 DDL / 业务写入                  |
| mem-report.sh                 | 本机与 PM2 内存报告             | 读取系统状态，按脚本说明使用部署用户 |
| apply-pg18-tuning.sh          | PostgreSQL 18 参数调整          | 修改服务器配置，执行前审查           |
| check-edgeone-media-config.ts | 检查可选缓存配置                | 不输出密钥                           |

```bash
# 只查看现有性能索引，不拉代码或重启
bash scripts/deploy.sh --check-db

# 只读查看可再生成的缓存占用
pnpm clean
```

首次完整部署仍是根目录 deploy.sh，见[部署指南](../docs/deployment.md)。两个同名脚本职责不同。

## 数据库初始化与业务维护

| 脚本                                                         | 用途                                                      |
| ------------------------------------------------------------ | --------------------------------------------------------- |
| bootstrap-admin.ts                                           | 一次性创建初始管理员                                      |
| ensure-entry-registration-form.ts                            | 补齐入监登记模板                                          |
| reconcile-profile-record-sequence.ts                         | 核对 / 整理档案编号                                       |
| seed.ts / seed-scoreboard-demo.ts                            | 非生产演示数据，不能用于业务库                            |
| setup-e2e-database.mjs / e2e-database-target.mjs             | 固定隔离库初始化与目标校验                                |
| cleanup-chat.ts / cleanup-notices.ts / cleanup-audit-logs.ts | 按对应策略清理记录，可能删除数据                          |
| update-geoip.ts                                              | 从 GitHub 下载并校验合并 IP 库（Merged-IP.mmdb，约 96MB） |
| reset-mfa.mjs                                                | 开发/测试账号 MFA 状态查询与显式重置                      |

通知合并升级使用 `upgrade-notice-groups.mjs` 准备字段，`merge-notice-history.ts` 默认只预览，添加 `--apply --database=<目标数据库>` 才整理历史。两个部署入口会自动执行；详见[通知规则](../docs/notifications.md)。

MFA 工具已从根目录移入 scripts。只读查询也需要指定用户名：

```bash
node --env-file=.env.local scripts/reset-mfa.mjs test-user
```

上例的 test-user 替换为实际测试账号。写操作需 --apply 和 --confirm-database=<目标库名>，仅用于开发/测试；NODE_ENV=production 会拒绝执行。不要把该工具当作生产账号恢复流程。

## 已登记增量升级

| 脚本                           | 范围                       |
| ------------------------------ | -------------------------- |
| upgrade-web-performance.mjs    | 性能索引                   |
| upgrade-chat-caption.mjs       | 图片说明                   |
| upgrade-review-snapshot.mjs    | 审核快照                   |
| upgrade-community.mjs          | 匿名社区与自愿分享         |
| upgrade-library.mjs            | 图书、阅读、管理与内容版本 |
| upgrade-isolation-schedule.mjs | 禁闭任务排程               |
| upgrade-auto-review.mjs        | 自动任务 / 补卡审核        |

正常部署按既定顺序调用，单独执行需明确数据库名并遵守脚本参数。--check-db / --rollback-db 只针对性能索引，不代表全库检查或整库回滚。

## 检查与本地工具

| 脚本                     | 用途                                       |
| ------------------------ | ------------------------------------------ |
| check-workflows.sh       | workflow 静态检查                          |
| test-clean-guard.mjs     | 缓存清理边界与占用保护                     |
| test-realtime-flow.mjs   | 实时服务健康、重连与心跳                   |
| test-deploy-flow.mjs     | 隔离模拟部署成功 / 失败流程                |
| start-production-e2e.mjs | 本地 standalone CSP 测试启动               |
| measure-web-bundles.mjs  | 构建体积测量                               |
| test-glm-review.ts       | 外部模型联调，可能发送文本并消耗额度       |
| clean.mjs                | 默认只报告，--apply 才清理指定可再生成内容 |

clean 默认范围还包含旧 App / Gradle 的可再生成缓存；本轮整理未执行 --apply。Android 构建较慢时保留缓存，不将清理当作每次构建前置步骤。

## 旧工作树兼容工具

sync-app-release.ps1 是旧 .app-workspace 到独立 App main 的同步工具，保留其路径供已有流程追溯；当前日常开发在独立 CustodySim-app，不能把有未提交改动的旧工作树直接覆盖同步。正常构建见[App 指南](../docs/android-development.md)。

新增脚本放此目录并补充用途；不要把临时诊断脚本、设备日志或下载的工具提交到根目录。仓库整体布局见[目录说明](../docs/repository-layout.md)。
