#!/usr/bin/env bash
#
# 生产部署：拉代码 → 装依赖 → 构建 → 复制 standalone 静态资源 → 重启 → 自检
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

echo "==> 1/6 拉取代码"
git pull --ff-only

echo "==> 2/6 安装依赖"
pnpm install --frozen-lockfile

echo "==> 3/6 构建"
pnpm build

echo "==> 4/6 复制 standalone 静态资源（public + .next/static）"
mkdir -p .next/standalone/public .next/standalone/.next .logs
cp -r public/. .next/standalone/public/
cp -r .next/static/. .next/standalone/.next/static/

# ecosystem.config.cjs 会手动加载 .env.local（standalone 不会自动读），缺了就跑不起来。
if [[ ! -f .env.local ]]; then
  echo "缺少 .env.local（DATABASE_URL / AUTH_SECRET 等）：请先从备份恢复再部署" >&2
  exit 1
fi

echo "==> 5/6 重启 pm2"
pm2 restart all
sleep 3
pm2 list

echo "==> 6/6 自检"
curl -s -o /dev/null -w "首页                %{http_code}\n" http://127.0.0.1:3000/
curl -s -o /dev/null -w "静态资源 window.svg %{http_code}\n" http://127.0.0.1:3000/window.svg
curl -s -o /dev/null -w "接口 /api/me        %{http_code}（401=服务正常但未登录）\n" http://127.0.0.1:3000/api/me
echo "完成。异常时看日志：pm2 logs custodysim --lines 50 --nostream"
