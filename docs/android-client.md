# 安卓客户端接入规格

面向 Kotlin + Compose 客户端（工程计划放在本仓库 `android/`）。服务端原生接口已就绪，本文是客户端开发的接口依据。

服务端所有站内接口都能用 Bearer 令牌直接调用，因此本文只写**原生特有**、**易踩坑**和**别等**的部分。本文与代码冲突时以代码为准，并回改本文。

## 1. 必带的请求头

| 头 | 值 | 说明 |
|---|---|---|
| `X-CustodySim-Client` | `android-app/1` | **写请求必须带**。值需匹配 `^android-app/\d+$`，协议变更时递增数字 |
| `Authorization` | `Bearer <访问令牌>` | 带它就**完全不看 cookie**，不做回退 |
| `Content-Type` | `application/json` | |
| `X-CustodySim-Trusted-Device` | `<deviceId>.<token>` | 可选。登录时携带，跳过 MFA（见 3.2） |

客户端头的作用是**豁免同源校验**：生产环境 `/api/**` 的写请求必须有可信 `Origin`，而原生 HTTP 客户端默认不发该头，会被一律 403。它不参与鉴权——伪造它也拿不到权限（浏览器跨源页面无法伪造，因为自定义头会先触发 CORS 预检，而服务端不为第三方来源放行）。

建议用 OkHttp Interceptor 统一添加前两个头，业务代码不感知。

## 2. 统一响应包

```jsonc
// 成功
{ "success": true, "data": { /* ... */ } }

// 失败
{ "success": false, "error": { "code": "UNAUTHORIZED", "message": "登录已过期，请重新登录" } }
```

`code` 取值：`UNAUTHORIZED`、`FORBIDDEN`、`NOT_FOUND`、`VALIDATION_ERROR`、`CONFLICT`、`RATE_LIMITED`、`INTERNAL_ERROR`。

**客户端动作映射**（照这个做，不要一律"弹 toast 就完事"）：

| HTTP | 动作 |
|---|---|
| 401 | 先尝试刷新令牌（见 3.3）；刷新也 401 → 清本地凭证回登录页 |
| 403 | **不要清凭证**。多为缺客户端头或权限不足，清凭证会把用户无故登出 |
| 400 | 表单校验失败。注意：登录与改密接口的 `message` 是 **JSON 字符串**（字段错误映射），别直接展示给用户 |
| 409 | 状态冲突。位置场景表示"数据早于最新记录"，应重新采集后重报 |
| 429 | 退避重试，`message` 里写了剩余秒数 |
| 5xx | **保留凭证**，指数退避重试 |

## 3. 鉴权

### 3.1 登录

`POST /api/auth/login`

```jsonc
// 请求
{ "username": "u123", "password": "******" }
```

| 情况 | 响应 |
|---|---|
| 无 MFA | `data = { id, username, name, role, organizationId, mustChangePassword, token, refreshToken, expiresInSeconds: 28800 }` |
| 已启用 MFA | `data = { requiresMfa: true, mfaToken: "<挑战令牌，5 分钟有效>" }` |
| 用户名或密码错误 | 401 `用户名或密码错误` |
| 尝试过于频繁 | 429，`message` 含剩余秒数（按用户名 + IP 限流） |

会话字段固定为 `id / username / name / role / organizationId / mustChangePassword`（`SessionUserSchema`）。`role` ∈ `ADMIN` | `SUPERVISOR` | `SUPERVISED`。

### 3.2 MFA 二次验证

`POST /api/auth/mfa/verify`

```jsonc
{ "code": "123456", "trustDevice": false, "mfaToken": "<3.1 收到的 mfaToken>" }
```

- **`trustDevice` 缺省为 `true`**（服务端 schema 默认值）。共用终端必须显式传 `false`，否则会在 30 天内免二次验证。
- `code` 支持验证器代码与恢复码，长度 6–32。
- 成功：`data = { ...会话字段, token, refreshToken, expiresInSeconds, trustedDevice? }`
- `trustedDevice` 形如 `<deviceId>.<token>`，**持久化保存**；下次登录时放进 `X-CustodySim-Trusted-Device` 头即可跳过 MFA。有效期 30 天。
- 挑战过期/未携带 → 401；验证码错误或已使用 → 400；尝试频繁 → 429。

### 3.3 刷新访问令牌

`POST /api/auth/refresh` → `{ "refreshToken": "..." }`

- 成功：`data = { ...会话字段, token, expiresInSeconds, refreshToken }`，**返回的是新的刷新令牌**。
- **每次刷新即轮换**，旧刷新令牌立即作废；用旧的再刷 → 401。
- 该接口**只接受原生客户端**：不带 `X-CustodySim-Client` 调用 → 403，**且不消耗令牌**（这次失败不影响后续正常刷新）。
- 因此：**同一时刻只能有一个刷新在途**。并发刷新会有一路拿到 401（旧令牌已被轮换作废），必须用互斥锁/单例把刷新请求合并，否则会把用户踢回登录页。
- 建议：访问令牌 8 小时，在剩余 15–30 分钟时提前静默刷新。

### 3.4 登出

`POST /api/auth/logout`（带 Bearer，无请求体）→ `data = { loggedOut: true }`

- 服务端会 `tokenVersion + 1`，**等价于退出全部设备**：该账号所有访问令牌与刷新令牌立即失效。
- **信任设备授权有意保留**（在网页端安全设置的设备列表里撤销）。App 如需"退出并撤销本机信任"，请另行提示用户。

### 3.5 修改密码

`POST /api/auth/change-password`（带 Bearer）

```jsonc
{ "currentPassword": "...", "newPassword": "...", "confirmPassword": "..." }
```

- 新密码规则：≥8 位，至少一个字母 + 一个数字；不能与当前密码相同。
- 限流：429（敏感操作限流，按用户 + IP）。
- 当前密码错误 → 400；并发冲突 → 409（提示重新登录后重试）。
- **重要**：成功响应的 `data` 只有会话字段，**不包含新令牌**（新令牌只写进了 cookie，原生客户端拿不到）。而本次改密已使 `tokenVersion` 递增 → **App 必须在改密成功后强制重新登录**，同时清掉本地保存的 `trustedDevice`（服务端已撤销全部信任设备）。

### 3.6 令牌与吊销矩阵

| 操作 | 访问令牌 | 刷新令牌 | 信任设备 | 实时通道 |
|---|---|---|---|---|
| 登出 | 失效 | 失效 | 保留 | 断开 |
| 改密 | 失效 | 失效 | 撤销 | 断开 |
| 启用/关闭 MFA | 失效 | 失效 | — | 断开 |
| 账号停用 | 失效 | 失效 | — | 断开 |
| 刷新令牌 | 旧的作废 | **轮换** | — | — |

访问令牌 8 小时（`AUTH_TOKEN_TTL_SECONDS`），刷新令牌 30 天。真正的失效控制靠服务端的 `users.tokenVersion`，不靠过期时间——所以**"刷新返回 401 就回登录页"是唯一正确的处理**。

### 3.7 客户端实现要求

- 令牌与 `trustedDevice` 存 **Keystore 加密**（`EncryptedSharedPreferences` 或 DataStore + Keystore 封装）。不要写日志、不要进崩溃上报、不要放外部存储。
- 启动流程：有本地凭证 → `GET /api/me`（轻量）→ 401 则走刷新 → 仍失败则清凭证回登录。
- `mustChangePassword: true` 时，除改密外的请求都会被判未登录 → 必须做强制改密引导，别让用户撞 401 循环。

## 4. 位置上报

服务端下发的策略是**唯一真源**，客户端不要硬编码数字。

### 4.1 策略

`GET /api/mobile/location/config` → `data`：

```jsonc
{
  "minIntervalSeconds": 60,        // 允许的最快上报间隔（下限）
  "maxIntervalSeconds": 3600,      // 允许的最慢上报间隔（上限）
  "maxPointsPerBatch": 180,        // 单批上限，超出需自行分片
  "maxPointsPerDay": 1584,         // 近 24 小时点数上限
  "maxReportAgeSeconds": 21600,    // 单点最大滞后（6 小时）
  "maxFutureSkewSeconds": 300,     // 允许的未来偏差（5 分钟）
  "retentionHours": 72             // 坐标保留期，超期物理删除
}
```

### 4.2 批量上报

`POST /api/mobile/location/batch`（**仅 `SUPERVISED` 角色**，否则 403）

```jsonc
{
  "points": [
    { "latitude": 31.2304, "longitude": 121.4737, "accuracyMeters": 15, "capturedAt": "2026-09-19T08:30:00.000Z" }
  ],
  "coordinateSystem": "GCJ02"
}
```

- 1–180 点/批；服务端按 `capturedAt` 升序处理。
- 超过每日上限 → 429（遵守最小间隔的客户端永远碰不到它）。
- **不新于已有记录的点会被跳过而不报错**（返回的 `skipped` 计数），所以"重试"是安全常态，别把重试做成幂等灾难。
- 成功 **201**：`data = { accepted, skipped, crossings, last }`。`crossings` 为本次触发越界的次数（服务端会自动建"越界说明"任务）。

### 4.3 单点即时判定

`POST /api/mobile/geofence/evaluate`（仅 `SUPERVISED`）

```jsonc
{ "latitude": 31.2304, "longitude": 121.4737, "accuracyMeters": 15, "capturedAt": "...", "coordinateSystem": "GCJ02" }
```

- 比轨迹更严：滞后 **≤15 分钟**、未来偏差 ≤5 分钟。
- 成功：`data = { verdict, transition, distanceMeters, reportId, fence, explanationTaskId }`；`verdict` ∈ `INSIDE` | `OUTSIDE` | `NOT_CONFIGURED` | `NOT_APPLICABLE`。
- 数据不新于最新记录 → **409**，应提示"定位数据早于最新记录，请重新采集"。

### 4.4 坐标系：必须 GCJ02（最容易出错的一点）

Android `LocationManager` / `FusedLocationProvider` 返回的是 **WGS84**，而服务端与腾讯底图都按 **GCJ02** 处理。两者在国内偏差 **300–600 米**，直接上报会让合规的人被判越界。

处理方式二选一：

1. 使用国内定位 SDK（高德/腾讯）直接拿 GCJ02；
2. 自行做 WGS84 → GCJ02 转换，**并写单元测试**（拿已知点对表校验）。

不要传 BD09（百度坐标系），也不要传 WGS84。这个转换值得单独封一个类，别散落在调用点。

### 4.5 调度与权限建议

- 用 **WorkManager** 做周期性采集上报，不要常驻前台 Service；间隔从 4.1 的策略里取（建议 5–15 分钟）。
- 离线队列：本地库按 `capturedAt` 排序，成批 ≤180 点发送；失败按指数退避重试，进程重启后继续（服务端接受 6 小时内的滞后，不必强行立刻送达）。
- 权限：`ACCESS_FINE_LOCATION` + `ACCESS_BACKGROUND_LOCATION`（Android 10+ 需单独申请，先请求前台再请求后台）；Android 14 起若有前台服务需声明 `foregroundServiceType="location"`。
- 各厂商 ROM 的省电白名单会显著影响后台采集，需要在设置页给出引导；Doze 下延迟属正常，服务端容忍 6 小时滞后。

## 5. 图片上传（打卡照片 / 申请附件）

打卡照片与补卡凭证用 `photo`（**单张**）；申请附件用 `attachments`（**数组，最多 3 张**）。值统一为 **data URL**：

```
data:image/(jpeg|png|webp);base64,<...>
```

- 压缩后单张 ≤ **1 MB**；原图 ≤ 5 MB（客户端负责压缩）。
- 只有 jpeg / png / webp 三种；**HEIC/HEIF 不在白名单**，需先转 JPEG。
- 多张时整个请求体约 4 MB，反向代理已按 8 MB 放行；客户端不必再省。

## 6. 实时通道（聊天）

1. 取令牌：`POST /api/chat/realtime-token`，请求体 `{ "conversationId": "<uuid>" }`（带 Bearer）→ `data = { token }`。该令牌是**用途限定 JWT，只对这一个会话有效**。
2. 连接 Socket.IO：地址 `http://<主机>:3001`，`path: "/socket.io"`，`transports: ["websocket", "polling"]`，认证载荷放在 `auth`：

```kotlin
val options = IO.Options().apply {
    path = "/socket.io"
    auth = mapOf("token" to realtimeToken)
}
```

3. 服务端会校验 `purpose`、`tokenVersion` 与账号状态；**令牌到期会被强制断开**（不是刷新，是断连）→ 到期前重新取令牌并重连。
4. 事件：`conversation:join`（携带 ack 回调，返回 `{ ok: true|false }`）。其余事件（消息、已读、撤回等）以 `realtime-server.mjs` 为准。
5. 原生客户端不发 `Origin`，**不受 CORS 限制**（服务端的来源白名单只约束浏览器）。

## 7. 其它可用接口

站内接口对 App 全部可用，用同一枚 Bearer 调用即可，不需要"移动端专用"版本。常用入口：

| 路径 | 用途 |
|---|---|
| `GET /api/me` | 会话校验 |
| `/api/checkins` | 点名打卡 |
| `/api/makeups` | 补卡申请 |
| `/api/applications` | 申诉与呈报 |
| `/api/chat/*` | 聊天（配合第 6 节） |

角色限制注意：位置上报与单点判定**只对 `SUPERVISED` 开放**；监管员/管理员角色的 App 不要调用这组接口。

## 8. 尚未提供（别等，按现状设计）

- **推送**：没有 FCM/厂商推送通道。越界告警、任务提醒目前只能靠客户端轮询。
- **增量同步**：没有游标式离线同步接口，各页面按需拉取。
- **版本协商**：`android-app/N` 只是客户端标识，服务端没有强制升级接口。

## 9. 联调与维护

- 真机连本地开发服务器：用局域网 IP（`http://192.168.x.x:3000`），不要用 `localhost`。
- 生产走 HTTPS 域名；`X-CustodySim-Client` 头不因 HTTPS 变化。
- 契约锚点（改协议时先看这两个文件）：
  - `e2e/business/native-auth.test.ts`——登录、MFA、刷新轮换、登出吊销
  - `e2e/business/location-track.test.ts`——批量上报、查询、权限边界
- 协议变更流程：修改 `lib/native-client.ts` 中的版本正则 → 更新本文 → 递增客户端头版本号。
