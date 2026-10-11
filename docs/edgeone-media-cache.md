# EdgeOne 图片与书籍缓存

本方案适用于现有 Next.js 源站与同域腾讯云 EdgeOne 网站安全加速。图书封面、社区图片和聊天图片在节点缓存 1 天；书籍原文件（PDF/TXT/EPUB/DOCX）、EPUB 插图和公共阅读正文缓存 7 天。每次请求（包括缓存命中）先向源站做当前登录身份与资源权限校验。鉴权不缓存，且不查询图片/Base64/电子书字节。节省的是文件回源带宽与解析，不是全部 API/数据库请求。

为了保留聊天撤回、成员移除、账号停用/退出、图书下架和社区删除的权限规则，本方案使用边缘函数远程鉴权，不只依赖有时效的 URL 防盗链。现有资源 URL 与旧 App 协议不变，没有客户端密钥。源站向函数签发 30 秒回源凭据，绑定用户、完整资源路径与内容版本；源站取字节时再次校验当前会话和资源权限。源站直接访问仍走原有鉴权，不开放匿名文件。

## 其他静态资源

EdgeOne 站点规则保持“遵循源站缓存头”。Next.js 为带内容哈希的 `/_next/static/*` 构建资源（JS、CSS、字体等）返回 `public, max-age=31536000, immutable`，因此会按一年 TTL 缓存在 EdgeOne 节点和浏览器，无需再按 `.js`、`.css` 等扩展名强制缓存。部署产生新内容时文件名会变化，旧文件不会覆盖新版本。Next.js 的动态页面按用户请求动态生成，不应套用此规则。

不要把这一年 TTL 扩展到整个站点或全部文件扩展名：未版本化的 `public/` 文件不声明不可变长缓存；任务、打卡、聊天记录等个性化 API 继续 `private, no-store`。PDF.js worker/字体/CMAP/WASM 路由虽然声明 `public, max-age=3600`，当前 `proxy.ts` 的 API 默认策略会覆盖为 `private, no-store`，本轮不修改短缓存。图片、书籍原文件和 EPUB 插图只通过专用鉴权函数缓存；其他带权限的文件不进入共享缓存。

Web 阅读器打开 PDF 请求完整 `/api/library/{id}/file`，其他格式请求 `/document`，EPUB 插图请求 `/resource?path=...`。Android 保留独立的 128 MB 阅读磁盘缓存，按源站、用户和书籍内容版本隔离，重复打开先请求 `/document?metadata=1` 校验当前访问权限，再复用本地正文/PDF/插图。这不同于 OkHttp 的 25 MB HTTP 缓存：边缘函数返回 `no-store`，后者不会保存图片或书籍响应；阅读器自己的缓存仍可工作。

`/document` 现在也能命中 CDN：源站的内部回源接口只输出字段白名单中的公共正文，不含 `readerKey`、进度或其他个人字段；函数先做实时鉴权，再读取公共副本，按当前授权返回的阅读标识组装原有响应。用户标识不进入缓存键或缓存副本，不增加客户端请求、不更改旧 App 协议。`?metadata=1` 明确旁路共享缓存，保留原接口的实时权限和用户身份检查。源站另有按书籍 ID、内容版本、格式和渲染版本隔离的解析缓存，最多 8 本、按序列化大小预算 24 MB；同版本重复打开不再读取整本字节或重复解析。进程重启会清空源站内存缓存。

`library_books.content_revision` 是存储生成列，插入或替换书籍字节时由 PostgreSQL 自动计算；原有书籍由增量升级自动补齐。不依赖客户端版本参数，metadata 与边缘鉴权只查询小型字段。算法保持现有 `reader-schema-3:` SHA-256 截取 24 位的约定，旧 App 缓存与阅读位置仍可识别。部署脚本已通过 `upgrade-library.mjs` 接入升级，无新环境变量；首次升级需要计算现有书籍版本，保留原文件数据。此字段由数据库维护，上传/替换和其他写入路径均不能漏更新。

## 已启用正文缓存时修复 EPUB 545

EdgeOne 的 `Response.json()`、`text()` 和 `arrayBuffer()` 最多读取 1 MB；EPUB 解压后的正文 JSON 即使原文件较小也可能超过限制。新函数只校验源站的共享契约头和固定 JSON 开头，通过默认 `TransformStream` 流式添加本次用户的阅读标识，不读取或重新序列化整本正文。源站先按白名单去除个人字段，再添加 `X-CustodySim-Reader-Cache-Schema: reader-schema-3-v2`。新正文缓存键含 v2，自动隔离旧副本；原文件版本、阅读位置及 App 磁盘缓存格式不变。

1. 在现有边缘函数的触发规则中，暂时移除 `/api/library/*/document`，保留图片、封面、原文件和插图规则。等待规则生效后确认原接口可以阅读。普通节点缓存仍保持不缓存正文。
2. 服务器执行下面的 Bash，更新源站。无需改变原有环境变量、密钥或 Android APK，也没有新增数据库迁移：

   ```bash
   cd ~/CustodySim
   git pull --ff-only
   bash scripts/deploy.sh
   ```

3. 源站部署成功后，在现有边缘函数代码编辑器中，用仓库 `deploy/edgeone/media-cache.js` 的完整最新内容替换旧代码，保存并发布。确认代码中的 `READER_CACHE_SCHEMA` 是 `reader-schema-3-v2`。只部署源站或只更新函数都会导致正文契约不匹配。
4. 重新加入 `/api/library/*/document` 触发规则并发布，等待配置下发。同一本 EPUB 完整打开两次，正文请求应为 200，响应头有 `X-CustodySim-Reader-Cache-Schema: reader-schema-3-v2`；首次 `MISS/PENDING`，后台写入完成后第二次可 `HIT`。同时确认章节、中文、插图和阅读位置正常。
5. 若仍为 545，先再次撤掉正文触发规则恢复阅读，再获取该请求对应的边缘函数异常日志。`Error return from script` 是通用失败提示，不能单独证明异常原因。流式修复已在本地对超过 1 MB、跨块 UTF-8 正文及不同用户命中做回归，真实节点仍需按上述步骤验收。

## 启用顺序

1. 在生产 `.env.local` 增加下述配置；独立密钥仅保存在源站，不填到前端、App、边缘函数代码或 Git：

   ```dotenv
   EDGEONE_MEDIA_CACHE_ENABLED=true
   EDGEONE_MEDIA_SIGNING_KEY=<独立随机密钥，至少32字符>
   ```

   Bash 生成密钥：`node -e 'console.log(require("node:crypto").randomBytes(32).toString("hex"))'`。该值不要发送到聊天或日志。

2. 更新并运行原有 `bash scripts/deploy.sh`。部署脚本在构建/重启前检查配置，并自动执行 `content_revision` 增量升级；已升级可重复执行，本次正文缓存没有额外数据库变更。无需更新 Android APK 或修改 CI 的生产部署逻辑。没有启用时旧接口照常工作。

3. 在 EdgeOne 控制台确认以下路径**不走普通强制缓存**，包括现有“缓存全部”规则；鉴权响应、原始图片响应和函数输出不得被另一层缓存绕过：

   - `/api/media/authorize`、`/api/media/content`：节点与浏览器均不缓存，错误响应不缓存。
   - 下述图片/书籍/插图路径：普通节点缓存不缓存；字节缓存由函数的 Cache API 独立管理。

   在原有“不缓存”规则的路径正则里加入书籍文件、插图和正文接口（URI 路径条件，不含查询参数）：

   ```regex
   ^(/api/media/.*|/api/chat/messages/[^/]+/image|/api/library/[^/]+/(cover|file|resource|document)|/api/community/images/[^/]+)$
   ```

4. 进入 **边缘函数**（不是 EdgeOne Pages），更新现有函数，粘贴 `deploy/edgeone/media-cache.js` 全部内容。函数无密钥或私有域名，使用当前请求的同域源站。绑定业务域名，只为以下路径创建触发规则；代码还会严格校验 UUID、查询参数和完整路径：

   ```text
   /api/chat/messages/*/image
   /api/library/*/cover
   /api/community/images/*
   /api/library/*/file
   /api/library/*/resource
   /api/library/*/document
   ```

   字节存放在独立命名空间 `custodysim-private-media-v1`，缓存键是 Cache API 内部标识，不会被 Fetch 或直接 URL 请求。不要再绑定旧路径 `/__custodysim_media_cache/*`，EdgeOne 会拒绝该路径上的 Cache API 操作。不要绑定 `/api/*` 或 `/api/media/*`，避免子请求触发函数回环。回源必须保留 Cookie、Authorization、`x-custodysim-client` 和完整查询参数；代理不能增加或替换用户身份。不要对本方案路径额外开启内置 Token 鉴权、忽略 Cookie 后强制缓存或缓存鉴权成功结果。

   升级时先部署源站与数据库，再发布新函数并增加所缺的书籍触发路径。已有正文触发规则时，先按上面的 545 修复顺序暂时移除该规则。源站已更新而正文函数未更新时，共享契约不匹配会返回 503；撤掉正文触发规则后原接口保持可用。不需要更新 Android APK。

5. 发布函数后，按下面的验收检查确认缓存与权限同时生效。实际套餐需支持边缘函数和 Cache API；没有这项能力时保持关闭，不能用“强制缓存”替代。

## 缓存与失效

- 函数先获取授权，再 `cache.match`。同一图片的不同用户共享字节，用户的 Cookie/JWT/签名不进入缓存内容或缓存键。
- 书籍键使用数据库内容版本；替换文件自动换键，旧凭据不能取到新版本字节。EPUB 插图额外按规范化的完整 `path` 参数计算键，不能把同一本书的不同插图混为同一缓存。SVG 插图的缓存副本保留固定 sandbox CSP。
- 正文缓存键额外包含 `reader-schema-3-v2` 共享契约版本；变更格式时须同步更新 `lib/reader-identity.ts` 与函数常量。命中后用户阅读标识由本次授权重建，原始个性化 JSON 不存入缓存。
- 封面版本取自数据库 `cover_updated_at`，不信任请求中的 `v`。更新封面自动换键；第一次给旧 EPUB/DOCX 补提封面不缓存，后续使用实际版本。图片内容在回源过程中变更时，不写入旧版本缓存。
- 客户端响应仍为 `private, no-store`；只有 Cache API 的内部副本设为可缓存。响应标记 `X-CustodySim-Media-Cache: MISS` 或 `HIT`，不含凭据。
- 已撤回/删除/下架内容即使节点还留有字节，也会因实时鉴权失败而不再向新的请求提供。已下载到设备上的内容无法被远程收回；已有 App 内存缓存和旧浏览器缓存不受此功能追溯清除。
- Cache API 缓存只在所在节点有效；不同节点首次访问会各自回源。鉴权或源站故障返回 503，不用旧授权或离线图片兜底。不存在和无权查看不区分具体原因，不缓存 401/403/404/5xx。
- 原文件首次 MISS 通过 `waitUntil` 后台写缓存，客户端立即开始接收文件；此时 `X-CustodySim-Media-Cache-Write: PENDING`。写入完成后再次请求可 HIT；失败会输出不含凭据的固定日志，并继续提供正常文件传输。当前阅读器使用完整文件下载，本次不增加 Range/断点续传协议。
- 任务附件、打卡凭证、签名、头像、阅读元数据和进度、普通业务 API 和 WebSocket 不在共享缓存范围。

## 验收

登录浏览器后，通过开发者工具取得某个真实图片路径（或用 App Bearer 令牌）。Bash 示例把令牌从标准输入读入，避免写进 shell 历史；不要共享令牌和 Cookie：

```bash
read -r -p '业务站点 HTTPS 地址: ' APP_URL
read -r -p '图片路径（以 /api/ 开头）: ' IMAGE_PATH
read -r -s -p '临时登录令牌: ' ACCESS_TOKEN; printf '\n'
for i in 1 2; do
  printf 'Authorization: Bearer %s\n' "$ACCESS_TOKEN" |
    curl -sS -H @- -D - -o /dev/null "${APP_URL%/}${IMAGE_PATH}"
done
unset ACCESS_TOKEN
```

同节点两次请求应均为 200，第一次 `MISS`，第二次 `HIT`；响应为图片类型且 `Cache-Control: private, no-store`。函数在 MISS 时等待缓存写入并即时回读确认，不会把写入失败当作成功。用无凭据请求同一 URL 必须 401；撤回聊天消息后同一登录身份与 URL 必须 404；图书下架后普通用户 404（管理员依现有规则可看）；删除社区帖子后图片 404。更换封面后实际图像更新，不能继续命中旧版本。

书籍验收把路径换成 `/api/library/{id}/file` 或真实 `/resource?path=...`，不要用 `curl -I` 代替完整 GET 下载来判断大文件写入是否成功。原文件初次返回 `MISS/PENDING`，下载完成后再请求应 HIT；两次下载的 SHA-256 应一致。分别请求同书不同插图，内容应各自正确；替换书籍原文件后应 MISS 并下载新版本。书籍下架/删除、退出登录后，已有节点副本也不能绕过当前鉴权。最大 20 MB 文件仍需在实际 EdgeOne 节点验收；运行时写入失败按回源服务，不假定套餐与大对象能力已经验证。

如果一直 MISS，先检查以下响应头。仅有 MISS 不足以确定原因；`EO-Cache-Status` 也不能替代函数的 Cache API 状态。

正文验收：用 EPUB/TXT/DOCX 打开同一本书两次，查看无查询参数的 `/document` 请求；初次 `MISS/PENDING`，后台写完后可 HIT。用两个不同测试账号打开同书，正文相同但响应中的 `readerKey` 必须不同；`/document?metadata=1` 不显示共享缓存 HIT。替换书籍后正文版本变化；下架后普通用户返回 404。源站内存解析缓存即使命中也会先查询当前权限。旧 App 的原 JSON 字段、阅读位置和本地缓存行为保持兼容。

| 响应头                           | 值            | 含义                                                                    |
| -------------------------------- | ------------- | ----------------------------------------------------------------------- |
| `X-CustodySim-Media-Cache-Write` | `STORED`      | 写入后即时回读成功；持续 MISS 时对照同一 URL、节点、版本和请求缓存指令  |
| 同上                             | `NOT-STORED`  | put 返回后即时回读没有该条目，需检查 Cache API 能力、运行日志与规则影响 |
| 同上                             | `ERROR`       | 写入或写入后验证抛出异常；边缘日志输出固定的失败提示，不输出凭据        |
| 同上                             | `SKIP-TYPE`   | 源站图片 MIME 不在 PNG/JPEG/WebP 允许列表，检查响应 `Content-Type`      |
| 同上                             | `SKIP-LEGACY` | 旧封面没有稳定版本，暂不缓存；聊天图片不应出现此值                      |
| 同上                             | `NOT-NEEDED`  | 已命中缓存，无需写入                                                    |
| 同上                             | `PENDING`     | 书籍原文件正在后台写缓存，下载完成后再次请求验证 HIT                    |
| `X-CustodySim-Media-Cache-Read`  | `ERROR`       | 初始缓存读取抛错（过期也可能抛 504）；结合写入结果判断                  |

写入/验证失败时另有 `X-CustodySim-Media-Cache-Error`，仅包含数字状态码或 `UNKNOWN`，不输出原始异常消息。413 表示 API 拒绝了缓存副本，不能据此直接认定为文件过大。

浏览器验收先取消开发者工具的 Disable cache，避免请求携带 `Cache-Control: no-cache`/`Pragma: no-cache` 干扰对照；正常重新打开聊天页面，不使用强制刷新。函数返回 no-store，正常加载仍会发起请求。若需复现调试模式，再单独对比请求。不要为了排障把原始图片、鉴权接口或内部键改成普通强制缓存，也不要改用默认缓存命名空间。

本地回归包含签名过期/篡改、跨用户取字节、真实数据库撤回/成员移除/留存期、账号令牌撤销、封面变更/下架、社区删除，以及执行实际函数源码的缓存命中后拒绝、HEAD、缓存过期和关闭回退测试。本地测试不替代 EdgeOne 真实节点验收。

## Cache API 独立探针

如果读取、写入诊断都为 ERROR/UNKNOWN，不能直接认定为套餐限制或普通缓存规则冲突；写入 ERROR 也可能来自写入后的回读。创建临时独立边缘函数 `custodysim-cache-probe`，粘贴 `deploy/edgeone/cache-probe.js`，仅为业务 HOST 和精确路径 `/__custodysim_cache_probe` 设置 AND 触发条件。正常访问该业务路径（不要访问函数默认预览域名），把 JSON 结果用于定位，不需要登录凭据。

探针不查询源站、不访问实际业务图片，也不把 Cookie/Authorization 传给任何缓存操作；每个缓存副本只有固定公开测试文字，TTL 为 60 秒。异常文字来自这些独立操作，结果可以分享。它分别测试 Request 对象/字符串键、曾被保护的路径/中性测试路径、独立命名空间/默认命名空间，并标明异常发生在 open、put 还是 match。只有默认命名空间的中性测试键会进入默认缓存，内容始终为公开测试文字；业务图片仍只使用独立命名空间。

完成排查后删除探针的触发规则及临时函数。不要把现有图片函数替换为探针，也不要用探针默认缓存的结果直接改动业务图片鉴权。

## 关闭与回滚

将 `EDGEONE_MEDIA_CACHE_ENABLED=false` 并重新运行部署脚本。鉴权端点返回 204，已发布函数改走原接口的正常鉴权，不读取 Cache API。也可撤掉触发规则回到旧链路。若回滚到不支持书籍缓存的源站版本，先撤掉书籍触发规则或关闭该功能。新增生成列可保留，不改变旧文件内容。节点内部图片字节随 1 天、书籍/插图随 7 天 TTL 淘汰。如有数据清理要求，按 EdgeOne Cache API/节点管理能力清理，不能把普通 URL 清除成功当成内部自定义缓存键已全部清除。

参考：[EdgeOne 远程鉴权](https://cloud.tencent.com/document/product/1552/100946)、[Cache API](https://intl.cloud.tencent.com/zh/document/product/1145/52684)、[同域 Fetch 行为](https://cloud.tencent.cn/document/product/1552/81897)、[Response 读取限制](https://cloud.tencent.com/document/product/1552/81917)、[TransformStream 运行时限制](https://cloud.tencent.com/document/product/1552/81923)。
