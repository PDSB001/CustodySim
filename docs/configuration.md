# 配置参考

面向开发和技术维护人员。这里的“配置”指服务器和构建参数；普通用户的头像、外观、打卡 GPS 与位置上传设置见[使用指南](user-guide.md)。

以 [.env.example](../.env.example) 和读取配置的代码为准。服务端使用根目录 `.env.local`；Android 使用 `android/local.properties`。两者不可互相替代，不提交真实凭据和私有域名。

## 基础配置

| 配置                               | 用途与要求                                                       |
| ---------------------------------- | ---------------------------------------------------------------- |
| `DATABASE_URL`                     | PostgreSQL 连接串，生产必填；需事先创建数据库和有权限的账号      |
| `DATABASE_POOL_MAX`                | Web 连接池上限，默认 20；还需为实时进程和维护连接留余量          |
| `AUTH_SECRET`                      | 独立随机会话签名密钥，至少 32 字符；示例占位符会被拒绝           |
| `MFA_ENCRYPTION_KEY`               | 独立且稳定的 MFA 密钥，至少 32 字符，不随会话密钥一起轮换        |
| `ARCHIVE_SIGNATURE_ENCRYPTION_KEY` | 手写签名加密密钥，未配时回退 AUTH_SECRET；已有数据不可直接换钥匙 |
| `APP_ORIGIN`                       | 生产 HTTPS 来源，供写操作来源验证和浏览器实时白名单使用          |
| `AUTH_COOKIE_SECURE`               | HTTPS 生产 true；仅 HTTP 开发可设 false                          |
| `TRUST_PROXY`                      | 仅在服务只能经过可信代理，且代理覆盖 X-Real-IP 时设 true         |

密码存储使用 bcrypt（cost 12，见 `lib/auth.ts`），不是 MD5 或单次 SHA。会话、MFA 和档案签名是不同用途的密钥，备份时与数据库一并妥善保管；轮换前明确旧数据和会话的影响。

## 聊天与端口

| 配置                            | 默认 / 说明                                                        |
| ------------------------------- | ------------------------------------------------------------------ |
| `PORT`                          | PM2 Web 默认 3000                                                  |
| `REALTIME_PORT`                 | 实时服务默认 3001                                                  |
| `NEXT_PUBLIC_CHAT_REALTIME_URL` | 留空使用同源反代；开发可指定开发机 3001 地址；构建时进入浏览器产物 |
| `CHAT_RETENTION_DAYS`           | 实时维护任务硬删除天数，默认 28，必须是正整数                      |

普通用户读取窗口 14 天、监管审计窗口 28 天由 `lib/chat.ts` 定义，修改清理变量不会同步改变读取窗口。实时服务启动时及此后每 6 小时清理。PM2 配置加载 `.env.local`，修改服务端参数需 `--update-env`；公开构建变量变化还需重新构建。

部署自检按单个 `APP_ORIGIN=https://example.com` 读取公开地址，建议采用这一格式，不带路径和尾斜杠。服务端密钥不可加 `NEXT_PUBLIC_` 前缀。

## 可选与一次性参数

| 配置                                         | 用途                                                               |
| -------------------------------------------- | ------------------------------------------------------------------ |
| `NEXT_PUBLIC_TENCENT_MAP_KEY`                | 腾讯地图浏览器 Key，控制台限制域名，电子围栏使用 GCJ-02            |
| `MAXMIND_LICENSE_KEY` / `MAXMIND_GEOIP_CONF` | 本地 GeoIP 数据更新，命令 `pnpm geoip:update`                      |
| `GLM_API_KEY`                                | 自动任务审核服务端 Key，还需[管理端设置](automatic-task-review.md) |
| `TENCENT_SES_*`                              | 安全邮箱验证码与通知，具体字段见[SES 指南](security-email.md)      |
| `INITIAL_ADMIN_*`                            | 一次性管理员初始化，密码使用后移除，不保存进 shell 历史            |
| `ALLOW_DEMO_SEED`                            | 非生产演示数据显式开关，生产禁止启用                               |
| `E2E_DATABASE_NAME` / `E2E_DATABASE_URL`     | 独立测试库，URL 优先                                               |
| `E2E_BASE_URL`                               | Playwright 地址                                                    |

打卡关闭 GPS 时采用本地 geoip-lite 的 IP 粗略城市信息，不把 IP 发到第三方定位接口；精确定位另行使用移动端权限和服务端策略。可选服务未配置时，不应视对应能力为已上线。
