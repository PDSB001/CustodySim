#!/usr/bin/env bash
set -euo pipefail

pnpm install --frozen-lockfile

# 读取 .env.local 中的键，不覆盖已存在的 shell 环境变量。
env_local_value() {
  [[ -f .env.local ]] || return 1
  sed -n "s/^[[:space:]]*$1[[:space:]]*=[[:space:]]*//p" .env.local | tail -n 1
}

# 密钥可能只写在 .env.local（scripts/update-geoip.ts 通过 --env-file 读取），
# 因此不能只看 shell 环境变量。
if [[ -n "${MAXMIND_LICENSE_KEY:-}" ]] ||
  [[ -n "$(env_local_value MAXMIND_LICENSE_KEY || true)" ]]; then
  pnpm geoip:update
fi

pnpm lint
pnpm typecheck
pnpm test
pnpm build

# Next.js standalone output intentionally omits public and static assets.
# Copy them into the runtime bundle before PM2 switches to the new build.
mkdir -p .next/standalone/public .next/standalone/.next/static
cp -a public/. .next/standalone/public/
cp -a .next/static/. .next/standalone/.next/static/

# 结构变更前先留一份可回滚快照。
DB_URL="${DATABASE_URL:-$(env_local_value DATABASE_URL || true)}"
if [[ -n "$DB_URL" ]] && command -v pg_dump >/dev/null 2>&1; then
  mkdir -p .backups
  pg_dump "$DB_URL" > ".backups/pre-deploy-$(date +%Y%m%d-%H%M%S).sql"
  echo "已生成数据库备份：.backups/pre-deploy-*.sql"
else
  echo "警告：未找到 DATABASE_URL 或 pg_dump，已跳过数据库备份" >&2
fi

# Production schema changes must remain interactive so destructive statements
# cannot be accepted silently during an incremental deployment.
pnpm exec drizzle-kit push --config=drizzle.config.ts --strict

mkdir -p .logs
pm2 startOrReload ecosystem.config.cjs --only custodysim --update-env
pm2 startOrReload ecosystem.config.cjs --only custodysim-chat-realtime --update-env
pm2 save
