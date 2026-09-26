#!/usr/bin/env bash
#
# 生产部署：拉代码 → 装依赖 → 构建 → 复制静态资源 → 数据库升级 → 重启 → 自检
#
#   bash scripts/deploy.sh
#
# 背景：next.config.ts 用了 output: "standalone"，而 `.next/standalone` 里**不含**
# `public/` 与 `.next/static/`（Next 要求自行复制）。这一步只有部署环境才需要，
# 所以不能塞进 package.json 的 build（Windows 本地开发没有 cp -r）。放这里固化，
# 免得每次重构后忘记复制 → 页面能开、样式与图片全 404。
#
set -euo pipefail

cd "$(dirname "$0")/.."
echo "==> 部署目录：$(pwd)"

MODE="${1:-deploy}"
if [[ $# -gt 1 ]]; then
  echo "每次只能指定一个选项。使用 --help 查看用法。" >&2
  exit 1
fi
case "$MODE" in
  deploy|--check-db|--rollback-db) ;;
  --help|-h)
    echo "bash scripts/deploy.sh                构建、升级数据库索引、重启并自检"
    echo "bash scripts/deploy.sh --check-db     只检查当前配置数据库的升级状态"
    echo "bash scripts/deploy.sh --rollback-db  只回滚本轮新增索引，不重启服务"
    exit 0
    ;;
  *) echo "未知选项：$MODE" >&2; exit 1 ;;
esac

check_env() {
  if [[ ! -f .env.local ]]; then
    echo "缺少 .env.local：请先恢复部署配置。" >&2
    exit 1
  fi
}

# 公开访问地址（APP_ORIGIN）：浏览器与 App 就是按这个地址连实时通道的。
# 取不到就跳过公开自检，避免在没有该配置的环境里误报失败。
public_origin() {
  local value
  value="$(sed -n 's/^[[:space:]]*\(export[[:space:]]\+\)\?APP_ORIGIN[[:space:]]*=[[:space:]]*"\?\([^"[:space:]]*\)"\?.*$/\2/p' .env.local 2>/dev/null | head -n 1)"
  printf '%s' "${value%/}"
}

upgrade_database() {
  check_env
  # 只输出数据库名，不在日志或进程参数里展开连接串/密码。
  local database_name
  database_name="$(node --input-type=module -e '
    import { config } from "dotenv";
    config({ path: ".env.local", quiet: true });
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL 未配置");
    const name = decodeURIComponent(new URL(process.env.DATABASE_URL).pathname.slice(1));
    if (!name) throw new Error("DATABASE_URL 必须显式指定数据库名");
    process.stdout.write(name);
  ')"
  node scripts/upgrade-web-performance.mjs "$1" "--database=$database_name"
  if [[ "$1" == "--apply" ]]; then
    node scripts/upgrade-chat-caption.mjs "--database=$database_name"
    # 批阅快照列：缺了它 /api/reviews 与批阅写入都会 500（幂等，可重复执行）。
    node scripts/upgrade-review-snapshot.mjs "--database=$database_name"
  fi
}

if [[ "$MODE" == "--check-db" ]]; then
  upgrade_database --check
  exit 0
fi
if [[ "$MODE" == "--rollback-db" ]]; then
  upgrade_database --rollback
  exit 0
fi

echo "==> 1/7 拉取代码"
git pull --ff-only

echo "==> 2/7 安装依赖"
pnpm install --frozen-lockfile
check_env

echo "==> 3/7 构建"
pnpm build

echo "==> 4/7 复制 standalone 静态资源（public + .next/static）"
mkdir -p .next/standalone/public .next/standalone/.next .logs
cp -r public/. .next/standalone/public/
cp -r .next/static/. .next/standalone/.next/static/

echo "==> 5/7 数据库索引与字段升级（聊天图片说明、批阅快照）"
upgrade_database --apply

echo "==> 6/7 重启 pm2"
pm2 restart ecosystem.config.cjs --update-env
pm2 list

echo "==> 7/7 自检"
check_http() {
  local url="$1" expected="$2" status attempt
  for attempt in 1 2 3 4 5; do
    status="$(curl --silent --show-error --connect-timeout 3 --max-time 10 -o /dev/null -w '%{http_code}' "$url")" || status="000"
    if [[ "$status" == "$expected" ]]; then
      echo "$url → $status"
      return 0
    fi
    sleep 2
  done
  echo "自检失败：$url 返回 $status，预期 $expected。请检查 pm2 日志。" >&2
  return 1
}
# 公开实时通道：经 nginx 反代到 3001。缺了这段反代，Web 与 App 的 socket 都连不上，
# 聊天不报错但实时推送静默失效（只剩降级轮询），所以必须纳入自检。
check_public_realtime() {
  local origin body
  origin="$(public_origin)"
  if [[ -z "$origin" ]]; then
    echo "跳过公开实时通道自检：.env.local 未配置 APP_ORIGIN。"
    return 0
  fi
  body="$(curl --silent --show-error --connect-timeout 3 --max-time 10 \
    "$origin/socket.io/?EIO=4&transport=polling" || true)"
  # Engine.IO 握手首包固定以 0{ 开头（open packet）。
  if [[ "$body" == 0\{* ]]; then
    echo "$origin/socket.io/ → ${body:0:14}…"
    return 0
  fi
  echo "自检失败：$origin/socket.io/ 未返回 Socket.IO 握手（实际：${body:0:80}）。" >&2
  echo "多半是 nginx 缺少 /socket.io/ 反代：见 deploy/nginx/socket-io.conf。" >&2
  return 1
}
check_http http://127.0.0.1:3000/login 200
check_http http://127.0.0.1:3000/window.svg 200
check_http http://127.0.0.1:3000/api/me 401
check_http http://127.0.0.1:3001/health 200
check_public_realtime
echo "完成。异常时看日志：pm2 logs custodysim --lines 50 --nostream"
