#!/usr/bin/env bash
set -euo pipefail

pnpm install --frozen-lockfile
if [[ -n "${MAXMIND_LICENSE_KEY:-}" ]]; then
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

# Production schema changes must remain interactive so destructive statements
# cannot be accepted silently during an incremental deployment.
pnpm exec drizzle-kit push --config=drizzle.config.ts --strict

pm2 startOrReload ecosystem.config.cjs --only custodysim --update-env
pm2 startOrRestart ecosystem.config.cjs --only custodysim-chat-realtime --update-env
pm2 save
