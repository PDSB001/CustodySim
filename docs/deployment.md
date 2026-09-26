# 生产部署与排障

面向负责服务器的技术维护人员，需要服务器登录、应用目录、数据库和 Nginx 的管理权限。业务管理员日常操作见[管理人员指南](staff-guide.md)。

以下 Bash 示例假设仓库位于 `/home/ubuntu/CustodySim`，以 ubuntu 用户管理 PM2。域名统一使用 `example.com` 占位，替换为实际域名。本文不代表生产已执行任何操作。

## 两份脚本的区别

| 入口                     | 实际行为                                                                                                                                                  | 不包含什么                                                                                     |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| 根目录 `bash deploy.sh`  | 安装依赖；按密钥配置更新 GeoIP；lint/typecheck/test/build；复制静态资源；尝试 pg_dump 备份；交互式 strict schema push；startOrReload 两个 PM2 进程并 save | 不拉代码、不做公开 Socket.IO 自检；找不到 pg_dump 或连接串时会跳过备份                         |
| `bash scripts/deploy.sh` | git pull --ff-only；安装依赖；build；复制静态资源；应用性能索引和聊天 caption 列升级；restart PM2；HTTP 与 Socket.IO 自检                                 | 不运行 lint/类型/单元检查、不备份、不做全量 schema push；首次部署不能依赖 restart 创建全部进程 |

当前增量入口是 `scripts/deploy.sh`。它不是通用迁移器：其他表/列变更要另行检查。`--check-db` 仅检查性能索引，`--rollback-db` 仅回滚这些索引，不回滚 caption、应用代码或业务数据。

## 首次部署

1. 准备兼容项目的 Node、pnpm 12.4.2、PostgreSQL、PM2、Nginx 和证书；仓库放在上述目录。Web/实时端口不应暴露到不可信公网，尤其启用 TRUST_PROXY 时。
2. 配置 `.env.local`：DATABASE_URL、独立密钥、APP_ORIGIN、AUTH_COOKIE_SECURE=true；按[配置参考](configuration.md)填写可选功能。公网实时同源反代时留空 NEXT_PUBLIC_CHAT_REALTIME_URL。
3. 在新库执行完整初始化部署：

```bash
cd /home/ubuntu/CustodySim
bash deploy.sh
```

核对 schema push 展示的变更后再批准。已有业务库必须先确认备份可用，不能把脚本“尝试备份”当成备份保证。根脚本的备份连接串读取较简单，复杂引号/注释配置应使用单独验证过的备份流程。

4. 仅在没有管理员时创建初始账号，使用终端隐藏输入密码：

```bash
read -r -p '初始管理员账号: ' INITIAL_ADMIN_USERNAME
read -r -s -p '初始管理员密码: ' INITIAL_ADMIN_PASSWORD
printf '\n'
export INITIAL_ADMIN_USERNAME INITIAL_ADMIN_PASSWORD
pnpm db:bootstrap-admin
unset INITIAL_ADMIN_USERNAME INITIAL_ADMIN_PASSWORD
```

在 Web 首次登录改密。已有账号不执行此步骤，不在生产运行演示 seed。

5. 配置下节 Nginx 并验收。运行 `pm2 startup`，按其输出执行注册开机服务的命令，再 `pm2 save`。始终使用同一个部署用户，避免 sudo pm2 创建另一套进程。

## 增量部署

先把要发布的代码提交推送；服务器只能拉到远端已存在的提交。部署前：

```bash
cd /home/ubuntu/CustodySim
git status --short
git rev-parse HEAD
pm2 list
```

记录当前提交、保存 `.env.local` 和数据库一致性备份。确认两进程存在、分支有正确上游，且服务器没有需保留的源码修改。预先在开发或 CI 环境运行 lint、typecheck、test；按变更审查 schema。

```bash
bash scripts/deploy.sh
```

此脚本自动拉取代码和执行索引/caption 升级。若还有其他 schema 差异，应先在测试环境审查，再采用根脚本的完整流程；不要以为增量脚本同步了全部表。配置密钥变化前先检查旧数据解密与会话影响。

部署并非原子发布：构建会更新当前目录产物；失败时先看日志和进程状态，不保证全程零停机。回退应用到记录的旧提交也不会自动恢复数据库；数据库回退需基于审查过的兼容方案或已验证备份，不能直接删除业务数据。

## Nginx 完整示例

先用 `sudo nginx -T` 找到实际加载的站点文件，本项目常见为 `/etc/nginx/sites-enabled/custodysim`（可能链接到 sites-available）。备份后用 `sudoedit` 编辑，避免只改了未启用的文件。以下示例要求证书路径已存在；保持实际证书和已有额外配置。

```nginx
server {
    listen 80;
    listen [::]:80;
    server_name example.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    listen [::]:443 ssl;
    server_name example.com;

    ssl_certificate /etc/letsencrypt/live/example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/example.com/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;
    client_max_body_size 10m;

    location /socket.io/ {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 120s;
        proxy_send_timeout 120s;
        proxy_buffering off;
    }

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Socket.IO 的 proxy_pass 不附加尾斜杠路径，否则可能剥掉请求前缀。两个普通前缀 location 由最长前缀匹配，并非按书写先后匹配；已有正则 location 时需额外检查匹配关系。单独片段见 [socket-io.conf](../deploy/nginx/socket-io.conf)。

```bash
sudo nginx -t && sudo systemctl reload nginx
```

## 验收与排障

```bash
pm2 list
curl -i http://127.0.0.1:3000/login
curl -i http://127.0.0.1:3000/api/me
curl -i http://127.0.0.1:3001/health
curl -i 'http://127.0.0.1:3001/socket.io/?EIO=4&transport=polling'
curl -i 'https://example.com/socket.io/?EIO=4&transport=polling'
```

预期登录页 200，未登录 `/api/me` 401，实时 health 200，握手 200 且正文以 `0{"sid":` 开头。握手只证明传输通道到达实时服务，还需用已登录测试账号验证加入会话和实时收发。

| 症状                              | 排查方向                                                                   |
| --------------------------------- | -------------------------------------------------------------------------- |
| 3000 短暂拒绝连接，稍后正常       | 进程可能仍在启动；自检有重试，持续失败再查看 Web 日志                      |
| 本地握手正常，公网 308/404        | 请求多半到达 Next；检查实际启用的 HTTPS server 是否包含 Socket.IO location |
| Nginx 检查成功但行为未变          | 语法正确不代表编辑了生效文件，检查 `sudo nginx -T` 并确认 reload 成功      |
| 502 / 3001 不通                   | 检查 custodysim-chat-realtime 是否 online、端口与 env 是否正确             |
| 公网握手正常，Web 连不上          | 检查 APP_ORIGIN、浏览器构建时实时地址、认证和 WebSocket 升级               |
| 页面有数据但头像保存/图片说明失败 | 确认服务端代码已部署，caption 升级成功，检查接口日志                       |
| 上传 413                          | 检查生效的 client_max_body_size 和业务接口自身大小限制                     |
| CSS、图片 404                     | 检查 standalone 的 public 与 .next/static 是否复制                         |

```bash
pm2 logs custodysim --lines 80 --nostream
pm2 logs custodysim-chat-realtime --lines 80 --nostream
sudo nginx -T
```

Nginx 全量配置和日志可能包含私有信息，对外分享前删去敏感内容。数据库索引执行与回滚边界见[升级专题](database-web-performance-upgrade.md)。

## 交付给使用者

技术验收后交付实际 HTTPS 网址、经过验证的安装包版本、账号领取方式以及联系人的反馈渠道，并附上[使用指南](user-guide.md)和[常见问题](faq.md)。不要交付 `.env.local`、数据库密码或签名密钥。

向业务管理员说明本次开放的能力、未启用的可选服务和已知限制。特别确认移动端对应服务端已更新、首次改密需通过 Web，以及后台定位和离线聊天提醒的限制。使用普通账号走完一条真实的操作流程，再认为用户入口已验收。
