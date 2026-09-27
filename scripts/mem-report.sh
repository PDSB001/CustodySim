#!/usr/bin/env bash
# 真实内存占用报告（严格只读）。
#
# 关键点是 PSS 而不是 RSS：`shared_buffers` 这类共享内存被多个进程共同映射，
# 直接 ps 求和会把同一块内存重复计算好几遍；PSS 会把共享页按进程数均摊，
# 因此各组 PSS 相加才是真实占用。
#
#   sudo bash scripts/mem-report.sh
#
# 需要 root 读 /proc/<pid>/smaps_rollup；不需要装 psql（装了会顺带报 PG 配置）。
set -uo pipefail

if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
  echo "需要 root 才能读 /proc/<pid>/smaps_rollup：请用 sudo bash scripts/mem-report.sh" >&2
  exit 1
fi

# 各组内进程 PSS 之和（kB → MB），并逐个列出，便于区分 master / worker。
report_group() {
  local name="$1" total=0 pid value cmd
  printf '\n== %s ==\n' "$name"
  for pid in $(pgrep -x "$name" 2>/dev/null); do
    value="$(awk '/^Pss:/{s+=$2} END{print s+0}' "/proc/$pid/smaps_rollup" 2>/dev/null)"
    value="${value:-0}"
    cmd="$(tr -d '\0' < "/proc/$pid/cmdline" 2>/dev/null | cut -c1-70)"
    awk -v p="$pid" -v v="$value" -v c="$cmd" 'BEGIN{printf "  pid %-8s %8.1f MB  %s\n", p, v/1024, c}'
    total=$((total + value))
  done
  [[ "$total" -eq 0 ]] && echo "  （没有正在运行的进程）"
  awk -v n="$name" -v t="$total" 'BEGIN{printf "  → %s 合计 %.1f MB (PSS)\n", n, t/1024}'
  GROUP_TOTAL=$((GROUP_TOTAL + total))
}

echo "=== 机器总览 ==="
free -h
echo
echo "（PSS 已按共享页均摊，各组合计可直接相加；下面的总和与 free 的 used 应当接近。）"

GROUP_TOTAL=0
report_group postgres
report_group nginx
report_group node

echo
echo "=== pm2 两个应用（pm2 报的是 RSS，比 PSS 略高） ==="
if command -v pm2 >/dev/null 2>&1; then
  pm2 jlist 2>/dev/null | node -e 'const d=JSON.parse(require("fs").readFileSync(0,"utf8"));for(const a of d){console.log("  "+a.name.padEnd(24)+(a.monit.memory/1048576).toFixed(1)+" MB  restarts="+a.pm2_env.restart_time+"  uptime="+Math.round((Date.now()-a.pm2_env.pm_uptime)/60000)+"m")}'
else
  echo "  未找到 pm2"
fi

echo
awk -v t="$GROUP_TOTAL" 'BEGIN{printf "=== 本次统计到（postgres + nginx + node）合计 %6.1f MB (PSS) ===\n", t/1024}'

echo
echo "=== PG 相关配置（不占内存的项不做展示） ==="
DB_URL="${DATABASE_URL:-}"
if [[ -z "$DB_URL" && -f .env.local ]]; then
  # 只取连接串本身，不回显（与 deploy.sh 同一套解析方式）。
  DB_URL="$(sed -n 's/^[[:space:]]*\(export[[:space:]]\+\)\?DATABASE_URL[[:space:]]*=[[:space:]]*"\?\([^"[:space:]]*\)"\?.*$/\2/p' .env.local | head -n 1)"
fi
if command -v psql >/dev/null 2>&1; then
  if [[ -n "$DB_URL" ]]; then
    psql "$DB_URL" -tAc "select name || ' = ' || setting || ' ' || coalesce(unit,'') from pg_settings
      where name in ('shared_buffers','work_mem','maintenance_work_mem','max_connections','autovacuum_max_workers')
      order by name;"
  else
    echo "  未取到 DATABASE_URL；改用本地 postgres 角色查询："
    sudo -u postgres psql -tAc "select name || ' = ' || setting || ' ' || coalesce(unit,'') from pg_settings
      where name in ('shared_buffers','work_mem','maintenance_work_mem','max_connections','autovacuum_max_workers')
      order by name;" 2>/dev/null || echo "  查询失败：请手动执行 show shared_buffers;"
  fi
  echo "  提示：work_mem 是「每个排序/哈希算子」的额度，不是每个连接；effective_cache_size 与 max_wal_size 都不占内存。"
else
  echo "  未找到 psql（apt install postgresql-client 可补）。"
fi
