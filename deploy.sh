#!/usr/bin/env bash
set -euo pipefail

pnpm install --frozen-lockfile
if [[ -n "${MAXMIND_LICENSE_KEY:-}" ]]; then
  pnpm geoip:update
fi
pnpm db:push
pnpm db:seed
pnpm build
pm2 start ecosystem.config.cjs --env production
pm2 save
