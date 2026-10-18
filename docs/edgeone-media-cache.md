# EdgeOne 图片、书籍与正文缓存

核对日期：2026-10-18。适用于同域腾讯云 EdgeOne 网站加速与本仓库边缘函数。请按本页从源站到边缘依次配置，不使用普通强制缓存替代鉴权。

![每次鉴权、共享字节和 App 本地缓存的关系](assets/cache-flow.svg)

## 先看缓存范围

| 资源                                       | 缓存位置 / 时长          | 权限与限制                              |
| ------------------------------------------ | ------------------------ | --------------------------------------- |
| /_next/static/* 带哈希 JS、CSS、字体等     | 遵循源站，一年 immutable | 不把一年 TTL 扩展到动态页面或所有扩展名 |
| 聊天图、封面、社区图                       | 函数命名 Cache API，1 天 | 每次请求实时鉴权                        |
| 书籍 /file、EPUB /resource、公共 /document | 函数命名 Cache API，7 天 | 按内容版本与路径隔离                    |
| 个人 API、metadata、阅读进度、鉴权         | 不共享缓存               | private, no-store                       |
| Android 阅读内容                           | 独立 128 MiB 磁盘缓存    | 每次开书先在线 metadata 验证权限与版本  |
| Android OkHttp                             | 25 MiB HTTP 缓存         | 遵循响应头，不保存 no-store 响应        |

未版本化 public 文件不统一加不可变长缓存。PDF.js worker/字体/CMap/WASM 路由的短缓存被当前 API 代理策略覆盖，本方案不调整它们。

共享字节不含 Cookie、JWT、个人进度或 readerKey。用户 readerKey 由每次授权生成响应头返回，客户端检查后合并。命中仍会访问源站校验当前身份与资源范围；节省的是文件字节与解析回源，不是所有 API 调用。

## 第一步：源站配置与部署

在 .env.local 启用可选能力：

```dotenv
EDGEONE_MEDIA_CACHE_ENABLED=true
EDGEONE_MEDIA_SIGNING_KEY=<独立随机密钥，至少32字符>
```

密钥只放源站，不写进函数、Web、App 或 Git，也不能复用 AUTH_SECRET。Bash 生成：

```bash
node -e 'console.log(require("node:crypto").randomBytes(32).toString("hex"))'
```

保存该值后正常部署：

```bash
cd ~/CustodySim
git pull --ff-only
bash scripts/deploy.sh
```

脚本先检查缓存配置，图书馆升级自动补齐 content_revision 生成列。已有密钥保持不变；仅开启 env 不会自动创建 EdgeOne 规则。未启用时保持原鉴权接口。

## 第二步：普通节点缓存旁路

进入站点的规则引擎，限制到实际业务 Host。对以下 **URL path 正则**设置：

- 节点缓存 TTL：不缓存。
- 浏览器缓存 TTL：遵循源站 Cache-Control。
- 离线缓存：关闭。
- 错误状态码缓存：不缓存，特别是 401/403/404/5xx。
- 保留完整查询参数与身份请求头。

```regex
^(/api/media/.*|/api/chat/messages/[^/]+/image|/api/library/[^/]+/(cover|file|resource|document|document-origin)|/api/community/images/[^/]+)$
```

这是普通缓存的旁路规则。下一步函数自己的命名 Cache API 管理公共字节，两者职责不同。API 无文件后缀，按 jpg/png 等后缀配置不会覆盖这些路由。/api/*、动态 HTML 和 /socket.io/ 不应被其他规则强制缓存。

## 第三步：发布边缘函数

使用 **边缘函数**，不是 Pages 中间件。将 [deploy/edgeone/media-cache.js](../deploy/edgeone/media-cache.js) 完整内容粘贴发布，绑定业务 Host，仅添加六条触发路径：

```text
/api/chat/messages/*/image
/api/library/*/cover
/api/community/images/*
/api/library/*/file
/api/library/*/resource
/api/library/*/document
```

**不要触发** /api/media/_、/api/library/_/document-origin、/api/* 或 document*。内部鉴权/取字节子请求不能再次触发函数。

当前版本常量供核对，不要只手改常量冒充升级：

| 常量                | 值                          |
| ------------------- | --------------------------- |
| FUNCTION_VERSION    | origin-gzip-v1              |
| READER_CACHE_SCHEMA | reader-schema-3-v2          |
| READER_DELIVERY_KEY | compressed-v1               |
| 命名 Cache API      | custodysim-private-media-v1 |

回源保留 Cookie、Authorization、X-CustodySim-Client 和完整查询参数。不要缓存授权成功结果，不额外开启会绕过本链路的忽略 Cookie 强制缓存。函数不需要填密钥，源站签发 30 秒、绑定用户/路径/版本的内部许可，取字节时再校验。

已有正文规则升级时，先暂时移除精确 document 触发规则，部署源站，再发布完整函数，最后恢复规则。配置生效需要时间，验收以实际响应版本为准。

## 第四步：验收图片和书籍

使用正常登录的浏览器，关闭 DevTools 的 Disable cache，避免强制刷新附带 no-cache 影响对照。同一节点、同一版本完整 GET 两次：

| 检查                       | 应看到什么                                          |
| -------------------------- | --------------------------------------------------- |
| 图片                       | 200、正确 MIME / 图像，先 MISS 再 HIT               |
| 原文件 /file               | 首次 MISS/PENDING，后台写完后 HIT，完整下载内容一致 |
| 插图 /resource?path=...    | 同书不同 path 返回各自图像                          |
| /document                  | shared-v1，完整正文可读，先 MISS/PENDING 后 HIT     |
| metadata=1                 | 正常实时校验，不显示公共正文 HIT                    |
| 无凭据                     | 401，不泄露缓存字节                                 |
| 撤回、删帖、下架或移除权限 | 相应账号后续访问被拒绝，不因已有副本放行            |

管理员的下架书可见权限不同于普通用户；软移出书架后所有角色隐藏。用不同角色核对实际授权，而不是假定相同结果。

对文件用完整 GET，不用 HEAD 判断大对象写入。Cache API 是节点本地缓存，不同节点的首次请求可分别 MISS。客户端输出仍 private, no-store，不代表内部公共字节没被缓存。

## 正文压缩与恢复

源站在白名单去除个人字段后异步生成 gzip。内部传输使用不透明压缩文件，不依赖边缘 Fetch/Cache 是否自动解码；函数不读取、拼接或重新序列化大 JSON。支持 gzip 的请求使用 gzip-v1 副本，identity 使用不同缓存键，gzip;q=0 不返回 gzip。

函数尝试设置 Content-Encoding: gzip，实际链路有时会去除该头；当前 Web 与 App 均按实际 gzip 文件头兼容解码，避免将压缩字节当 JSON或双重解压。App 首次正文也携带 shared-v1；重复打开先验证 metadata，再优先用磁盘内容。老 App 未声明共享协议时正常回源，不能期待正文 CDN HIT。

[EdgeOne 智能压缩](https://cloud.tencent.com/document/product/1552/70748)有大小及流式行为条件；“全部开启”不保证大正文响应被压缩。[Response API](https://cloud.tencent.com/document/product/1552/81917)的大正文读取限制也是函数避免 json/text/arrayBuffer 的原因。实际传输大小与解码后资源大小需要区分。

Web / App 遇到网络、解码、共享身份不匹配或 5xx，只恢复请求一次 **/document-origin**，重新鉴权；401/403/404 与主动取消不恢复。Web 恢复请求的 X-CustodySim-Reader-Recovery-Reason 为固定分类：

| 分类            | 意义                                   |
| --------------- | -------------------------------------- |
| http-5xx        | 首次正文请求服务端 / 边缘失败          |
| body-transfer   | 网络、字节读取或解压失败               |
| invalid-json    | 公共缓存内容不是合法 JSON              |
| shared-identity | 当前 readerKey / revision 与契约不匹配 |

200/HIT 只是响应状态与缓存查找成功，必须等正文完整接收、解析并正常显示，才算阅读成功。连续出现恢复请求时不能将其视为正常命中验收。

## 诊断头与常见故障

![按状态、传输和渲染分段定位阅读故障](assets/reader-troubleshooting.svg)

| 头                                  | 典型值 / 用途                                                          |
| ----------------------------------- | ---------------------------------------------------------------------- |
| X-CustodySim-Media-Cache            | HIT / MISS                                                             |
| X-CustodySim-Media-Cache-Read       | HIT、MISS 或 ERROR                                                     |
| X-CustodySim-Media-Cache-Write      | STORED、PENDING、NOT-NEEDED、NOT-STORED、ERROR、SKIP-TYPE、SKIP-LEGACY |
| X-CustodySim-Media-Cache-Error      | 状态数字或 UNKNOWN；不含原始异常                                       |
| X-CustodySim-Media-Function-Version | 当前完整函数版本                                                       |
| X-CustodySim-Media-Revision         | 当前内容版本                                                           |
| X-CustodySim-Reader-Delivery        | 正文 shared-v1                                                         |
| X-CustodySim-Reader-Representation  | gzip-v1 / identity-v1                                                  |
| X-CustodySim-Reader-Cache-Schema    | reader-schema-3-v2                                                     |
| X-CustodySim-Media-Failure-Stage    | 可捕获失败发生的阶段                                                   |

持续 MISS：比较节点、URL、版本、读写诊断和请求 no-cache 指令。EO-Cache-Status 不是自定义 Cache API 的最终依据。PENDING 表示后台写入，稍后再请求。

545 / 24 字节 / Error return from script：平台通用函数失败，单凭该响应无法确定具体异常。可捕获失败返回带阶段头的 503；545 且无版本头需要平台运行时异常日志。先移除精确 document 触发规则恢复阅读，保留源站正常鉴权。

HIT 仍慢：分别记录 TTFB、内容下载、实际传输大小、解析和首屏排版；压缩不能消除实时鉴权与客户端排版。不要通过降低权限校验换速度。

## Cache API 探针

仅在读写均 ERROR/UNKNOWN 时，使用 [cache-probe.js](../deploy/edgeone/cache-probe.js) 建临时独立函数，限定业务 Host 与精确 /__custodysim_cache_probe。它只操作固定公开测试文字，TTL 60 秒，不转发凭据、不查询业务资源。

探针区分命名/默认缓存、中性/旧内部路径及 put/match 阶段；结果不应直接替代业务安全规则。完成后删除探针函数与触发规则。

## 失效、关闭与边界

文件替换、封面更新按数据库版本换键；EPUB 插图还按规范化 path 隔离。共享正文另包含渲染契约和压缩传输版本，避免旧副本串用。已下载到设备的内容无法远程收回。

关闭时设 EDGEONE_MEDIA_CACHE_ENABLED=false 并正常部署，函数收到关闭状态后走原鉴权链路；也可撤掉对应触发规则。回退旧源站前先撤掉其不支持的触发规则。图片 1 天、书籍 7 天自然淘汰；普通 URL 刷新不保证清掉所有自定义内部键。

本地签名、撤权、跨用户与运行时模拟回归不能替代真实 EdgeOne 节点、套餐及大对象验证。

官方参考：[Cache API](https://intl.cloud.tencent.com/zh/document/product/1145/52684) · [同域 Fetch](https://cloud.tencent.cn/document/product/1552/81897) · [Response](https://cloud.tencent.com/document/product/1552/81917)。
