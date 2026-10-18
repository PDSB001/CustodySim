# 原生客户端接入规格

核对日期：2026-10-18。服务端契约由 CustodySim 维护，Android 实现在[独立仓库](https://github.com/PDSB001/CustodySim-app)。本文描述协议，不表示 App 提供全部 Web 管理入口。[旧版规格及事故记录](archive/android-client-legacy.md)只供历史参考。

## 1. 请求身份与发现

| 请求头                      | 当前约定                                                 |
| --------------------------- | -------------------------------------------------------- |
| X-CustodySim-Client         | 当前 App 为 android-app/2；服务端识别 android-app/N      |
| Authorization               | Bearer 访问令牌；头存在时不回退 Cookie                   |
| Content-Type                | JSON 请求 application/json；文件上传按接口使用 multipart |
| X-CustodySim-Trusted-Device | 可选，登录携带 deviceId.token                            |

原生头仅识别客户端及处理写操作的来源校验，不是授权凭据。服务端仍校验角色、账号状态与组织/监管范围。

匿名 GET /api/mobile/server-info 不携带令牌，返回 product、version、nativeProtocol 与 realtimePath，不查人员数据、不缓存。当前发现接口的兼容区间为 1–1；这是服务器检测契约，不能直接拿来替代聊天图片的 android-app/2 响应代际判断。服务器选择步骤见[服务器设置](server-selection.md)。

## 2. 响应与失败处理

```json
{ "success": true, "data": {} }
```

```json
{
  "success": false,
  "error": { "code": "UNAUTHORIZED", "message": "登录已过期，请重新登录" }
}
```

| HTTP       | 客户端行为                                                        |
| ---------- | ----------------------------------------------------------------- |
| 400        | 显示校验原因；部分认证字段错误 message 为 JSON 字符串映射，先解析 |
| 401        | 已登录业务请求只进行一次单飞刷新；刷新无效后清凭据重新登录        |
| 403        | 权限或来源失败，不当作无条件退出登录                              |
| 404        | 资源不可用，不推断是否存在无权限对象                              |
| 409        | 状态冲突，重新读取，不盲目重复写入                                |
| 429        | 尊重等待与退避，避免连续点击                                      |
| 5xx / 网络 | 保留凭据；写操作先核对是否已成功，不无限重发                      |

## 3. 登录、MFA、刷新与退出

- POST /api/auth/login 接收 username/password。无 MFA 返回会话字段、token、refreshToken、expiresInSeconds；需要 MFA 返回 requiresMfa/mfaToken。
- POST /api/auth/mfa/verify 接收 code、mfaToken、trustDevice。支持 TOTP 或恢复码；共用设备必须显式 trustDevice=false（服务端缺省 true）。可信设备有效期 30 天。
- POST /api/auth/refresh 仅原生客户端可用，提交 refreshToken；每次轮换并返回新令牌，同一时刻只允许一个刷新在途，旧令牌不能重复使用。
- 访问令牌当前 8 小时，刷新令牌 30 天；users.tokenVersion 与账号状态可提前使令牌失效，不能只检查 JWT 到期。
- POST /api/auth/logout 使该账号全部设备会话失效，保留信任设备授权，用户可在 Web 安全设置撤销。
- POST /api/auth/change-password 校验 currentPassword/newPassword/confirmPassword；成功会撤销旧令牌与信任设备。响应未提供新的原生令牌，App 必须重新登录。当前 App 改密入口仍使用 Web。

| 账号操作        | 会话与刷新令牌             | 信任设备 |
| --------------- | -------------------------- | -------- |
| 退出登录        | 全部失效                   | 保留     |
| 修改密码        | 全部失效                   | 撤销     |
| 启用 / 关闭 MFA | 旧会话失效                 | 撤销     |
| 停用账号        | 失效，重新启用不恢复旧令牌 | 撤销     |

令牌与草稿使用应用私有存储及 Keystore 加密边界；不写日志，不放外部存储。服务器切换关闭旧容器与定位队列，用户保存的服务器优先于 APK 默认值。

## 4. 位置上报

GET /api/mobile/location/config 是策略依据，不把数字硬编码进客户端。当前范围：60–3600 秒，单批最多 180 点，滞后最多 6 小时、未来偏差 5 分钟、近 24 小时最多 1584 点；坐标按当前保留策略清理。

POST /api/mobile/location/batch 仅 SUPERVISED 可调用：

```json
{
  "coordinateSystem": "GCJ02",
  "points": [
    {
      "latitude": 31.2304,
      "longitude": 121.4737,
      "accuracyMeters": 15,
      "capturedAt": "2026-10-18T00:00:00.000Z"
    }
  ]
}
```

返回 201，data 包含 accepted、skipped、crossings、last。旧点被跳过计数；批次超限应分片。单点 POST /api/mobile/geofence/evaluate 更严格，滞后最多 15 分钟，旧于最新记录返回 409，需重新采集。

系统定位与底图坐标系需正确转换，服务端要求 GCJ02；不能直接把 WGS84 标成 GCJ02。实际转换与边界测试跟随定位模块。

App 15 分钟及以上周期由 WorkManager 兜底，5/10 分钟在满足条件时使用 location 类型前台服务；权限分阶段申请。省电、Doze、强制停止和网络均会延迟，周期不是精确定时保证。打卡 GPS 和后台轨迹开关独立。详见 [App 权限](https://github.com/PDSB001/CustodySim-app/blob/main/docs/permissions.md)。

## 5. 图片与附件

打卡/补卡 photo 为单图；申请 attachments 最多三张。普通业务图片为 JPEG/PNG/WebP data URL，单张压缩后最多 1 MiB；HEIC 先转换。图书封面与文件是不同上传约定，见[图书馆](library.md)。

聊天 POST /api/chat/conversations/{id}/messages：

```json
{
  "type": "IMAGE",
  "content": "data:image/jpeg;base64,...",
  "caption": "可选说明"
}
```

图片可以不写说明；caption 最多 4000 字，TEXT 不可带非空 caption。代际 1 兼容内联 data URL；代际 2 及以上按 imageUrl 认证取图，不能只读 content。撤回后正文与说明为空、hasImage=false，不继续展示可访问图。

源站聊天图片是 API 默认 no-store 的特例，路由声明 private 长缓存；启用 EdgeOne 函数后客户端输出改为 private, no-store，字节在函数内部缓存。App 的内存图像缓存、25 MiB HTTP 缓存与阅读器磁盘缓存是不同层，不能据一个容量断定全部图片都落盘。

代理总请求上限当前 26 MiB，用于同时容纳图书文件与封面，不取消业务单图限制。权限图片不能统一设 public。

## 6. 聊天实时与增量补查

先 POST /api/chat/realtime-token（conversationId），取得用途与会话限定的短期 token；通过同源 /socket.io/ 连接实时进程，发送 conversation:join 并检查 ack。

Android 由 OkHttp WebSocket 实现 Engine.IO / Socket.IO 帧，不是 Java Socket.IO 客户端。服务端发送文本 ping 2，客户端响应 3：20 秒间隔、10 秒超时。实时凭据 300 秒到期，App 提前 60 秒换新，心跳不续期。

HTTP 消息支持 before/after UUID 游标，互斥；after 严格排除游标，正序最多 50 条，推进游标直至空页。断线恢复需补查消息、已读与撤回状态，不用“反复拉最新 50 条”代替。

Web 使用 Socket.IO 浏览器客户端；Nginx 将 /socket.io/ 转发到实时 3001，见[部署指南](deployment.md)。普通 App 没有 FCM/厂商离线推送，关闭应用不保证聊天通知。

## 7. 图书阅读与共享正文

EPUB/DOCX 使用 Episteme 原生引擎；TXT 为原生文本，PDF 为 PdfRenderer。每次开书先 GET /api/library/{id}/document?metadata=1，核对 readerKey、revision、格式与权限。

当前 App 首次正文携带 X-CustodySim-Reader-Delivery: shared-v1。公共响应不含个人 readerKey，客户端仅接受当次响应头并与 metadata 核对；按实际 gzip 文件头处理解压，再保存完整个人文档到 128 MiB 阅读缓存。文件资源按 origin/readerKey/revision/path 隔离。

网络/解码/共享身份错误和 5xx 只恢复一次 /document-origin；401/403/404 与取消不恢复。服务器与边缘规则必须保留独立恢复路径。旧服务端正常个人 JSON 保持兼容。见[EdgeOne](edgeone-media-cache.md)。

开始会话后每 15 秒串行心跳，非 RESUMED 或暂停不计；服务器只接受不超过 25 秒的连续片段，不按离线时间补记。阅读位置、时长和积分均由服务端确认。

## 8. 常用入口与验证锚点

| 功能        | 入口                        |
| ----------- | --------------------------- |
| 会话        | /api/me                     |
| 个人概览    | /api/my/overview            |
| 点名 / 补卡 | /api/checkins、/api/makeups |
| 申请        | /api/applications           |
| 图书        | /api/library                |
| 社区        | /api/community/posts        |

接口存在不等于所有角色可写；个人定位和打卡入口按服务端角色限制。改动前对照 [native-auth 回归](../e2e/business/native-auth.test.ts)、[定位回归](../e2e/business/location-track.test.ts)、[native-client.ts](../lib/native-client.ts) 与 App 的 AppConfig/ApiClient。

客户端头代际、服务器发现协议、共享正文版本是不同契约。扩展字段优先保持旧客户端兼容，不能只改标识而遗漏响应解析、权限与双端回归。
