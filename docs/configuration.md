# 配置参考

核对日期：2026-10-18。服务端配置使用本仓库 .env.local；App 构建配置使用独立仓库根目录 local.properties。两者不可替代。

示例见 [.env.example](../.env.example)。服务端进程修改配置后需重启；NEXT_PUBLIC_* 在 Web 构建时进入浏览器产物，变更后重新构建。不要给服务端密钥加 NEXT_PUBLIC_ 前缀。

## 必需配置与连接预算

| 配置                             | 当前用途                                                         |
| -------------------------------- | ---------------------------------------------------------------- |
| DATABASE_URL                     | PostgreSQL 连接串，必须显式指定数据库名                          |
| DATABASE_POOL_MAX                | Web 池上限，默认 20；还要为实时进程、升级和维护留连接            |
| AUTH_SECRET                      | 会话签名；独立随机值，至少 32 字符，拒绝示例占位符               |
| MFA_ENCRYPTION_KEY               | MFA/安全邮箱等加密；生产必填，稳定保存，不随会话密钥一起轮换     |
| ARCHIVE_SIGNATURE_ENCRYPTION_KEY | 手写签名加密；缺省兼容回退 AUTH_SECRET，新部署应单独配置         |
| APP_ORIGIN                       | 生产 HTTPS 来源，用于来源校验与实时白名单；推荐单个根地址        |
| AUTH_COOKIE_SECURE               | HTTPS true；仅 HTTP 开发 false                                   |
| TRUST_PROXY                      | 默认 false；只有应用只能被可信代理访问、代理覆盖真实 IP 头时启用 |

密码为 bcrypt cost 12。数据库备份不包含解密密钥的备份保证；丢失 MFA/签名密钥可能无法读取旧数据，轮换前审查兼容方案。

池配置不是模型速率上限：自动审核总占用每 Web 进程最多 min(5, floor(poolMax/4))，服务商/模型另受跨进程 PostgreSQL 锁限制。池不足 4 时模型审核暂停并提示原因，人工可继续。

## 聊天、端口与保活

| 配置                          | 默认 / 说明                                |
| ----------------------------- | ------------------------------------------ |
| PORT                          | PM2 Web 固定 3000                          |
| REALTIME_PORT                 | 独立运行默认 3001；PM2 配置固定 3001       |
| NEXT_PUBLIC_CHAT_REALTIME_URL | 留空走同源 /socket.io/；本地可指定实时端口 |
| CHAT_RETENTION_DAYS           | 默认 28，正整数，实时维护任务硬删除阈值    |

普通用户读取窗口 14 天、监管审计窗口 28 天由代码定义，改变删除阈值不会同步改变读取窗口。启动时及每 6 小时执行清理。

/health 在 PostgreSQL LISTEN 就绪时 200，否则 503；断开后每 5 秒安排重连。Engine.IO 服务端每 20 秒 ping，10 秒 pong 超时；Nginx 超时 120 秒大于这两者之和。该保活覆盖 CDN 300 秒空闲超时，不能绕过连接总寿命或网络中断。

实时凭据限单会话，5 分钟到期，Web 正常提前 1 分钟换新；心跳不延长权限。/socket.io/ 必须支持升级并旁路缓存，恢复后 HTTP 补查。见[架构](architecture.md)与[部署](deployment.md)。

## 模型与自动审核

| 配置                       | 用途                                         |
| -------------------------- | -------------------------------------------- |
| GLM_API_KEY                | 默认 BigModel 的独立服务端密钥               |
| ZAI_API_KEY                | 管理页切换 z.ai 后使用，不回退 BigModel 密钥 |
| GLM_REVIEW_MAX_CONCURRENCY | 可选整数 1–50，仍受数据库连接预算限制        |

当前模型随管理页服务商配置确定：BigModel 为 glm-4.1v-thinking-flash，z.ai 为 glm-4.5-flash。GLM_REVIEW_MODEL 不用于切换管理页模型；不要据旧测试环境变量认定当前选用 4.7。

开启、审核账号、模板、服务商、补卡独立开关保存在数据库；默认关闭。旧 AUTO_TASK_REVIEW_* 不再控制开关。密钥更改需重启，管理页服务商和范围保存后下次扫描读取。账号实际模型权益、可用性与额度以供应商控制台为准；详见[自动审核](automatic-task-review.md)。

## 可选资源与服务

| 配置                                              | 用途 / 约束                                  |
| ------------------------------------------------- | -------------------------------------------- |
| EDGEONE_MEDIA_CACHE_ENABLED                       | 默认 false，启用后还需配置边缘函数与旁路规则 |
| EDGEONE_MEDIA_SIGNING_KEY                         | 独立 >=32 字符，只在源站，不复用 AUTH_SECRET |
| NEXT_PUBLIC_TENCENT_MAP_KEY                       | 地图浏览器公开 key，控制台限制业务域名       |
| MAXMIND_LICENSE_KEY / MAXMIND_GEOIP_CONF          | 本地 GeoIP 更新，pnpm geoip:update           |
| TENCENT_SES_SECRET_ID / SECRET_KEY                | SES 凭据，仅服务端                           |
| TENCENT_SES_REGION / FROM                         | 与验证发信地址及模板地域一致                 |
| TENCENT_SES_CODE_TEMPLATE_ID / NOTICE_TEMPLATE_ID | 已审核模板，见[安全邮箱](security-email.md)  |

[EdgeOne 指南](edgeone-media-cache.md)区分浏览器、普通节点、命名 Cache API 和 App 磁盘缓存。启用 env 不会自动发布边缘函数或 Nginx 配置。

IP 粗定位由本地 geoip-lite 解析，不向第三方定位 API 发送访客 IP。打卡明细显示保存地点，历史缺失时可临时补解析；无法恢复历史截断 UA。原生头或旧 OkHttp UA 显示为 App，浏览器 UA 解析为名称版本。TRUST_PROXY 才是读取可信代理 IP 的开关。

## 一次性与测试配置

| 配置                                   | 使用方式                                                   |
| -------------------------------------- | ---------------------------------------------------------- |
| INITIAL_ADMIN_USERNAME / PASSWORD      | 仅一次性初始化，成功后删除                                 |
| INITIAL_ADMIN_NAME / ORGANIZATION_NAME | 可选初始名称与组织                                         |
| ALLOW_DEMO_SEED                        | 仅非生产演示显式 true，生产禁用                            |
| E2E_DATABASE_NAME / E2E_DATABASE_URL   | 固定隔离库 custodysim_e2e；URL 优先                        |
| E2E_BASE_URL                           | 普通 / 积分浏览器地址，默认本地 3100                       |
| E2E_PRODUCTION_BASE_URL                | 生产 CSP 本地地址，默认 3110；只允许 localhost / 127.0.0.1 |

数据库测试会写数据；不要把测试变量加入生产配置。脚本与 PM2 读取配置不代表 Bash 已有 DATABASE_URL，psql 用法见[运维手册](operations.md)。

## Android 配置边界

App 的 sdk.dir 与开发端点存独立仓库 local.properties；公开 release 不嵌入服务器默认值，production 可预置远端地址，debug/debugR8 支持联调。运行时明确选择的服务器优先，升级 APK 不应静默切走用户保存的选择。

详见[App 构建配置](https://github.com/PDSB001/CustodySim-app/blob/main/docs/android-development.md)和[服务器切换](server-selection.md)。
