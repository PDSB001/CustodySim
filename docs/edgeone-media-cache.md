# EdgeOne 图片缓存

本方案适用于现有 Next.js 源站与同域腾讯云 EdgeOne 网站安全加速。图书封面、社区图片和聊天图片在节点缓存 1 天；每次请求（包括缓存命中）先向源站做当前登录身份与资源权限校验。鉴权不缓存，且不查询图片/Base64/电子书字节。节省的是图片回源带宽与解码，不是全部 API/数据库请求。

为了保留聊天撤回、成员移除、账号停用/退出、图书下架和社区删除的权限规则，本方案使用边缘函数远程鉴权，不只依赖有时效的 URL 防盗链。图片 URL 与旧 App 协议不变，没有客户端密钥，没有短期 URL 到期后图片无法重试的问题。源站向函数签发 30 秒回源凭据，绑定用户、路径与图书封面版本；源站取字节时再次校验当前会话和资源权限。源站直接访问仍走原有鉴权，不开放匿名图片。

## 启用顺序

1. 在生产 `.env.local` 增加下述配置；独立密钥仅保存在源站，不填到前端、App、边缘函数代码或 Git：

   ```dotenv
   EDGEONE_MEDIA_CACHE_ENABLED=true
   EDGEONE_MEDIA_SIGNING_KEY=<独立随机密钥，至少32字符>
   ```

   Bash 生成密钥：`node -e 'console.log(require("node:crypto").randomBytes(32).toString("hex"))'`。该值不要发送到聊天或日志。

2. 更新并运行原有 `bash scripts/deploy.sh`。部署脚本在构建/重启前检查配置。无需数据库迁移、更新 Android APK 或修改 CI 的生产部署逻辑。没有启用时旧接口照常工作。

3. 在 EdgeOne 控制台确认以下路径**不走普通强制缓存**，包括现有“缓存全部”规则；鉴权响应、原始图片响应和函数输出不得被另一层缓存绕过：

   - `/api/media/authorize`、`/api/media/content`：节点与浏览器均不缓存，错误响应不缓存。
   - 下述三类原始图片路径：普通节点缓存不缓存；字节缓存由函数的 Cache API 独立管理。
   - `/__custodysim_media_cache/*`：普通节点缓存不缓存，保留为内部 Cache API 键，源站不提供这一 URL。

4. 进入 **边缘函数**（不是 EdgeOne Pages），创建函数，粘贴 `deploy/edgeone/media-cache.js` 全部内容。函数无密钥或私有域名，使用当前请求的同域源站。绑定业务域名，触发以下三类图片路径和一类内部键保护路径；可用规则支持的通配表达式匹配，代码还会严格校验 UUID 和完整路径：

   ```text
   /api/chat/messages/*/image
   /api/library/*/cover
   /api/community/images/*
   /__custodysim_media_cache/*
   ```

   最后一条必须绑定：直接访问内部键路径时函数返回 404，不进行缓存读取。字节同时存放在独立命名空间 `custodysim-private-media-v1`，不用默认 URL 缓存。不要绑定 `/api/*` 或 `/api/media/*`，避免子请求触发函数回环。回源必须保留 Cookie、Authorization 和 `x-custodysim-client`；代理不能增加或替换用户身份。不要对本方案图片路径额外开启内置 Token 鉴权、忽略 Cookie 后强制缓存或缓存鉴权成功结果。

5. 发布函数后，按下面的验收检查确认缓存与权限同时生效。实际套餐需支持边缘函数和 Cache API；没有这项能力时保持关闭，不能用“强制缓存”替代。

## 缓存与失效

- 函数先获取授权，再 `cache.match`。同一图片的不同用户共享字节，用户的 Cookie/JWT/签名不进入缓存内容或缓存键。
- 封面版本取自数据库 `cover_updated_at`，不信任请求中的 `v`。更新封面自动换键；第一次给旧 EPUB/DOCX 补提封面不缓存，后续使用实际版本。图片内容在回源过程中变更时，不写入旧版本缓存。
- 客户端响应仍为 `private, no-store`；只有 Cache API 的内部副本设为可缓存。响应标记 `X-CustodySim-Media-Cache: MISS` 或 `HIT`，不含凭据。
- 已撤回/删除/下架内容即使节点还留有字节，也会因实时鉴权失败而不再向新的请求提供。已下载到设备上的内容无法被远程收回；已有 App 内存缓存和旧浏览器缓存不受此功能追溯清除。
- Cache API 缓存只在所在节点有效；不同节点首次访问会各自回源。鉴权或源站故障返回 503，不用旧授权或离线图片兜底。不存在和无权查看不区分具体原因，不缓存 401/403/404/5xx。
- 仅三类图片启用；任务附件、打卡凭证、签名、头像、书籍全文、普通业务 API 和 WebSocket 不在本次共享缓存范围。

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

同节点两次请求应均为 200，第一次 `MISS`，第二次 `HIT`；响应为图片类型且 `Cache-Control: private, no-store`。缓存写入为异步，必要时稍后再请求一次。用无凭据请求同一 URL 必须 401；撤回聊天消息后同一登录身份与 URL 必须 404；图书下架后普通用户 404（管理员依现有规则可看）；删除社区帖子后图片 404。更换封面后实际图像更新，不能继续命中旧版本。

已命中的聊天图片还需测试其内部键：`/__custodysim_media_cache/v1/chat/<消息UUID>/0`。无论带不带登录凭据，都必须 404。这一步用于确认内部键保护触发规则没有漏配。

本地回归包含签名过期/篡改、跨用户取字节、真实数据库撤回/成员移除/留存期、账号令牌撤销、封面变更/下架、社区删除，以及执行实际函数源码的缓存命中后拒绝、HEAD、缓存过期和关闭回退测试。本地测试不替代 EdgeOne 真实节点验收。

## 关闭与回滚

将 `EDGEONE_MEDIA_CACHE_ENABLED=false` 并重新运行部署脚本。鉴权端点返回 204，已发布函数改走旧图片接口的正常鉴权，不读取 Cache API。也可撤掉图片触发规则回到旧链路。回滚不改数据库；节点内部字节随 1 天 TTL 淘汰。如有数据清理要求，按 EdgeOne Cache API/节点管理能力清理，不能把普通 URL 清除成功当成内部自定义缓存键已全部清除。

参考：[EdgeOne 远程鉴权](https://cloud.tencent.com/document/product/1552/100946)、[Cache API](https://intl.cloud.tencent.com/zh/document/product/1145/52684)、[同域 Fetch 行为](https://cloud.tencent.cn/document/product/1552/81897)。
