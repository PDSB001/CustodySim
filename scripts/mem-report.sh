#!/usr/bin/env bash
# 真实内存占用报告（严格只读）。
#
# 重要：**不要用 sudo 跑本脚本**。sudo 会把用户变成 root，而 pm2 按 HOME 区分实例，
# 于是 pm2 会去找 /root/.pm2、看不到你的应用，还会顺手 spawn 一个 root 的 pm2 守护进程。
# 正确用法是用"跑 pm2 的那个用户"执行；脚本内部只会对"读 /proc"这一步提权。
#
#   bash scripts/mem-report.sh
#
# 口径：用 PSS 而不是 RSS。shared_buffers 这类共享内存被多个进程共同映射，
# 按 RSS 求和会重复计算；PSS 会把共享页按进程数均摊，各组合计可直接相加。
set -uo pipefail

SUDO=""
if [[ "$(id -u)" -ne 0 ]]; then
  SUDO="sudo"
fi

# 读单个进程的 PSS（kB）。root 之外读不到 smaps_rollup，所以这一步提权。
pss_of() {
  $SUDO awk '/^Pss:/{s+=$2} END{print s+0}' "/proc/$1/smaps_rollup" 2>/dev/null || echo 0
}

TOTAL=0

report_group() {
  local label="$1"
  shift
  local total=0 pid value cmd
  printf '\n== %s ==\n' "$label"
  while read -r pid; do
    [[ -z "$pid" ]] && continue
    value="$(pss_of "$pid")"
    value="${value:-0}"
    cmd="$($SUDO tr -d '\0' < "/proc/$pid/cmdline" 2>/dev/null | cut -c1-70)"
    awk -v p="$pid" -v m="$value" -v c="$cmd" \
      'BEGIN{printf "  pid %-8s %8.1f MB  %s\n", p, m/1024, c}'
    total=$((total + value))
  done < <(pgrep "$@" 2>/dev/null | sort -u)
  [[ "$total" -eq 0 ]] && echo "  （没有匹配到进程）"
  awk -v n="$label" -v t="$total" 'BEGIN{printf "  → %s 合计 %.1f MB (PSS)\n", n, t/1024}'
  TOTAL=$((TOTAL + total))
}

echo "=== 机器总览 ==="
free -h
echo "（PSS 各组合计可直接相加；总和应当略小于 free 的 used，差额是共享内存被重复计算的部分。）"

report_group postgres -x postgres
report_group nginx -x nginx
# pm2 的应用在进程名上不一定叫 node（取决于启动方式），按命令行匹配更稳。
report_group "pm2 应用（按命令行匹配）" -f "standalone/server.js|realtime-server.mjs"

echo
echo "=== pm2 自报数据（RSS，比 PSS 略高，含共享库） ==="
if command -v pm2 >/dev/null 2>&1; then
  pm2 jlist 2>/dev/null | node -e '
const s = require("fs").readFileSync(0, "utf8");
const i = s.indexOf("[");
if (i < 0) { console.log("  pm2 没有返回 JSON（多半是当前用户不是跑 pm2 的那个）"); process.exit(0) }
for (const a of JSON.parse(s.slice(i))) {
  const up = Math.round((Date.now() - a.pm2_env.pm_uptime) / 60000);
  console.log("  " + String(a.name).padEnd(24) + (a.monit.memory / 1048576).toFixed(1) + " MB  restarts=" + a.pm2_env.restart_time + "  uptime=" + up + "m");
}
' || echo "  解析 pm2 输出失败"
else
  echo "  当前用户找不到 pm2 —— 请用跑 pm2 的用户执行本脚本"
fi

echo
awk -v t="$TOTAL" 'BEGIN{printf "=== 统计到（postgres + nginx + pm2 应用）合计 %6.1f MB (PSS) ===\n", t/1024}'

echo
echo "=== PG 配置（只是额度，不等于当前占用） ==="
DB_URL="${DATABASE_URL:-}"
if [[ -z "$DB_URL" && -f .env.local ]]; then
  DB_URL="$(sed -n 's/^[[:space:]]*\(export[[:space:]]\+\)\?DATABASE_URL[[:space:]]*=[[:space:]]*"\?\([^"[:space:]]*\)"\?.*$/\2/p' .env.local | head -n 1)"
fi
if command -v psql >/dev/null 2>&1; then
  QUERY="select name || ' = ' || setting || ' ' || coalesce(unit, '')
          || case name
               when 'shared_buffers' then '  （约 ' || (setting::bigint * 8 / 1024) || ' MB 上限，按被访问到的页逐步驻留）'
               when 'work_mem' then '  （每个排序/哈希算子，不是每连接）'
               when 'maintenance_work_mem' then '  （每个维护操作/autovacuum worker 的瞬时可占）'
               else '' end
          from pg_settings
          where name in ('shared_buffers','work_mem','maintenance_work_mem','max_connections','autovacuum_max_workers')
          order by name;"
  if [[ -n "$DB_URL" ]]; then
    psql "$DB_URL" -tAc "$QUERY"
  else
    sudo -u postgres psql -tAc "$QUERY" 2>/dev/null || echo "  未取到连接串，请手动执行 show shared_buffers;"
  fi
else
  echo "  未找到 psql（apt install postgresql-client 可补）"
fi
