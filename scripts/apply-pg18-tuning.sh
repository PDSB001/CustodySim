#!/usr/bin/env bash
#
# 一键应用 PostgreSQL 18 调优配置（Ubuntu / Debian，2GB 级小机器）
#
#   sudo bash scripts/apply-pg18-tuning.sh --dry-run     # 只看它会做什么，不落盘
#   sudo bash scripts/apply-pg18-tuning.sh               # 应用（重启前会确认一次）
#   sudo bash scripts/apply-pg18-tuning.sh --rollback    # 一键回到上一次备份
#
# 设计要点：
#   1. 先问服务器「你支持哪些取值」：wal_compression 不含 lz4 就不写；io_method 默认不动
#      （写成不支持的取值会让 postmaster 起不来）；
#   2. 档位按实际内存 + 是否与应用同机自动选择，避免 2GB 机器套用专用库参数把内存吃光；
#   3. 改配置前自动备份，重启后起不来会自动回滚并再重启；
#   4. 只有 --with-io-uring 才写 io_method = io_uring，且必须先确认 enumvals 里有它。
#
set -euo pipefail

PGVER=18
PROFILE=auto          # auto | cohosted | dedicated
ASSUME_YES=0
DRY_RUN=0
ROLLBACK=0
WITH_IO_URING=0
WITH_EXTENSION=1

log()  { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[警告]\033[0m %s\n' "$*"; }
die()  { printf '\033[1;31m[错误]\033[0m %s\n' "$*" >&2; exit 1; }

usage() {
  cat <<'EOF'
用法: sudo bash apply-pg18-tuning.sh [选项]

  --profile auto|cohosted|dedicated  内存档位（默认 auto：按内存与同机应用自动判断）
  --cohosted                         等价 --profile cohosted（PG 与应用同机）
  --dedicated                        等价 --profile dedicated（本机只跑 PG）
  --with-io-uring                    显式启用 io_method=io_uring（需构建带 liburing）
  --no-extension                     不预加载、不创建 pg_stat_statements
  --dry-run                          只打印将要写入的项，不修改任何文件
  --rollback                         恢复最近一次备份的 postgresql.conf 并重启
  -y, --yes                          跳过交互确认（重启有秒级中断）
  -h, --help                         显示本帮助
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --profile)       PROFILE="${2:?--profile 缺少取值}"; shift 2 ;;
    --cohosted)      PROFILE=cohosted; shift ;;
    --dedicated)     PROFILE=dedicated; shift ;;
    --with-io-uring) WITH_IO_URING=1; shift ;;
    --no-extension)  WITH_EXTENSION=0; shift ;;
    --dry-run)       DRY_RUN=1; shift ;;
    --rollback)      ROLLBACK=1; shift ;;
    -y|--yes)        ASSUME_YES=1; shift ;;
    -h|--help)       usage; exit 0 ;;
    *)               usage; die "未知参数：$1" ;;
  esac
done

[[ $EUID -eq 0 ]] || die "请用 sudo 或 root 运行"
command -v pg_lsclusters >/dev/null 2>&1 || die "找不到 pg_lsclusters（缺 postgresql-common）"

CLUSTER_LINE=$(pg_lsclusters -h 2>/dev/null | awk -v v="$PGVER" '$1 == v { print; exit }' || true)
[[ -n "${CLUSTER_LINE:-}" ]] || die "没有找到 PostgreSQL $PGVER 实例，请先安装：apt install -y postgresql-$PGVER postgresql-contrib-$PGVER"

CLUSTER=$(echo "$CLUSTER_LINE" | awk '{ print $2 }')
PORT=$(echo "$CLUSTER_LINE" | awk '{ print $3 }')
DATA_DIR=$(echo "$CLUSTER_LINE" | awk '{ print $6 }')
CONF="/etc/postgresql/$PGVER/$CLUSTER/postgresql.conf"
BIN="/usr/lib/postgresql/$PGVER/bin"
UNIT="postgresql@$PGVER-$CLUSTER"
[[ -f "$CONF" ]] || die "找不到配置文件：$CONF"

restart_cluster() {
  systemctl restart "$UNIT" 2>/dev/null && return 0
  systemctl restart postgresql 2>/dev/null && return 0
  pg_ctlcluster "$PGVER" "$CLUSTER" restart
}

wait_ready() {
  for _ in $(seq 1 30); do
    pg_isready -q -p "$PORT" && return 0
    sleep 1
  done
  return 1
}

# ------------------------------------------------------------------ 回滚分支
if [[ $ROLLBACK -eq 1 ]]; then
  BACKUP=$(ls -1t "$CONF".bak-* 2>/dev/null | head -1 || true)
  [[ -n "${BACKUP:-}" ]] || die "没找到备份文件（$CONF.bak-*）"
  log "恢复配置：$BACKUP → $CONF"
  cp -a "$BACKUP" "$CONF"
  restart_cluster
  wait_ready && log "回滚完成，实例已就绪" || die "回滚后实例仍未就绪，请查 journalctl -u $UNIT"
  exit 0
fi

# ------------------------------------------------------------- 实例与能力探测
if ! pg_isready -q -p "$PORT"; then
  log "实例未运行，先启动以便读取支持的取值范围"
  pg_ctlcluster "$PGVER" "$CLUSTER" start || true
  wait_ready || die "实例起不来，请先看 journalctl -u $UNIT"
fi

psql_run() { runuser -u postgres -- "$BIN/psql" -p "$PORT" -d postgres -tAc "$1" 2>/dev/null || true; }

VERNUM=$(psql_run "SHOW server_version_num" | tr -d ' \r')
[[ -n "${VERNUM:-}" ]] || die "连不上 PostgreSQL（端口 $PORT）"
[[ "$VERNUM" -ge 180000 ]] || die "当前版本号 $VERNUM 不是 PostgreSQL 18，本脚本按 18 编排"

WAL_ENUM=$(psql_run "SELECT coalesce(enumvals::text, '') FROM pg_settings WHERE name = 'wal_compression'" | tr -d '\r')
IO_EXISTS=$(psql_run "SELECT count(*) FROM pg_settings WHERE name = 'io_method'" | tr -d ' \r')
IO_ENUM=$(psql_run "SELECT coalesce(enumvals::text, '') FROM pg_settings WHERE name = 'io_method'" | tr -d '\r')
PRELOAD=$(psql_run "SELECT coalesce(setting, '') FROM pg_settings WHERE name = 'shared_preload_libraries'" | tr -d ' \r')

log "PostgreSQL $VERNUM（端口 $PORT，cluster $PGVER/$CLUSTER）"
log "取值支持：wal_compression=$WAL_ENUM  io_method=${IO_ENUM:-（无此参数）}"

# ------------------------------------------------------------------ 档位选择
RAM_MB=$(awk '/^MemTotal:/ { printf "%d", $2 / 1024 }' /proc/meminfo 2>/dev/null || true)
RAM_MB="${RAM_MB:-0}"
APP_PROCS=$( { pgrep -f 'next-server|next dev|pm2|node ' 2>/dev/null || true; } | wc -l | tr -d ' ')

if [[ "$PROFILE" == auto ]]; then
  if [[ "$RAM_MB" -lt 3072 && "$APP_PROCS" -gt 0 ]]; then
    PROFILE=cohosted; REASON="检测到 $APP_PROCS 个 node/pm2 进程，且内存 ${RAM_MB}MB < 3GB → 按与 PG 同机取值"
  elif [[ "$APP_PROCS" -gt 0 ]]; then
    PROFILE=cohosted; REASON="检测到 $APP_PROCS 个 node/pm2 进程 → 按与 PG 同机取值"
  elif [[ "$RAM_MB" -lt 3072 ]]; then
    PROFILE=cohosted; REASON="内存仅 ${RAM_MB}MB，即使独占也按保守档（避免连接基线吃满内存）"
  else
    PROFILE=dedicated; REASON="未检测到应用进程且内存 ${RAM_MB}MB 充足 → 按 PG 独占取值"
  fi
else
  REASON="由参数指定 --profile $PROFILE"
fi

if [[ "$RAM_MB" -lt 1024 ]]; then
  MAX_CONN=30; SHARED=128MB; MAINT=32MB; CACHE=512MB; TIER="<1GB"
elif [[ "$RAM_MB" -lt 3072 ]]; then
  if [[ "$PROFILE" == cohosted ]]; then
    MAX_CONN=50; SHARED=256MB; MAINT=64MB; CACHE=1024MB
  else
    MAX_CONN=100; SHARED=512MB; MAINT=128MB; CACHE=1536MB
  fi
  TIER="2GB"
else
  if [[ "$PROFILE" == cohosted ]]; then
    MAX_CONN=100; SHARED=512MB; MAINT=128MB; CACHE=2048MB
  else
    MAX_CONN=200; SHARED=1GB; MAINT=256MB; CACHE=3GB
  fi
  TIER=">=3GB"
fi

log "内存 ${RAM_MB}MB / 档位 $TIER / $PROFILE —— $REASON"
log "将写入：max_connections=$MAX_CONN shared_buffers=$SHARED maintenance_work_mem=$MAINT effective_cache_size=$CACHE"

# pg_stat_statements：库不存在就不预加载（否则起不来）
USE_EXTENSION=0
if [[ $WITH_EXTENSION -eq 1 ]]; then
  if [[ -f "/usr/lib/postgresql/$PGVER/lib/pg_stat_statements.so" ]]; then
    USE_EXTENSION=1
  else
    warn "缺少 pg_stat_statements.so（apt install postgresql-contrib-$PGVER），本次跳过慢查询统计"
  fi
fi

# io_method 只有显式要求 + 构建支持才写
USE_IO_URING=0
if [[ $WITH_IO_URING -eq 1 ]]; then
  if [[ "$IO_EXISTS" -gt 0 && "$IO_ENUM" == *io_uring* ]]; then
    USE_IO_URING=1
  else
    warn "这套构建不支持 io_uring（enumvals=${IO_ENUM:-无}），忽略 --with-io-uring"
  fi
fi

# ------------------------------------------------------------------ 待写入项
declare -a SETTINGS=(
  "max_connections|$MAX_CONN"
  "shared_buffers|$SHARED"
  "effective_cache_size|$CACHE"
  "maintenance_work_mem|$MAINT"
  "work_mem|4MB"
  "checkpoint_completion_target|0.9"
  "wal_buffers|16MB"
  "default_statistics_target|100"
  "random_page_cost|1.1"
  "effective_io_concurrency|200"
  "huge_pages|off"
  "jit|off"
  "min_wal_size|1GB"
  "max_wal_size|4GB"
  "log_min_duration_statement|1000"
)
if [[ "$WAL_ENUM" == *lz4* ]]; then
  SETTINGS+=("wal_compression|lz4")
else
  warn "wal_compression 不支持 lz4（enumvals=$WAL_ENUM），保持默认不写"
fi
if [[ $USE_IO_URING -eq 1 ]]; then SETTINGS+=("io_method|io_uring"); fi
if [[ $USE_EXTENSION -eq 1 ]]; then
  if [[ "$PRELOAD" == *pg_stat_statements* ]]; then
    log "shared_preload_libraries 已含 pg_stat_statements，保持：$PRELOAD"
  else
    SETTINGS+=("shared_preload_libraries|'${PRELOAD:+$PRELOAD,}pg_stat_statements'")
  fi
fi

if [[ $DRY_RUN -eq 1 ]]; then
  echo
  log "--dry-run：将写入 $CONF 的项如下（未修改任何文件）"
  for item in "${SETTINGS[@]}"; do printf '    %s = %s\n' "${item%%|*}" "${item##*|}"; done
  echo
  log "去掉 --dry-run 即真正应用（会先备份，重启失败自动回滚）"
  exit 0
fi

# ------------------------------------------------------------------ 确认
if [[ $ASSUME_YES -eq 0 ]]; then
  echo
  warn "接下来会修改 $CONF 并重启 PostgreSQL（已有连接会中断，通常几秒）"
  answer=""
  read -r -p "确认继续？[y/N] " answer || true
  [[ "$answer" == "y" || "$answer" == "Y" ]] || die "已取消，未做任何修改"
fi

# ------------------------------------------------------------------ 备份 + 写入
BACKUP="$CONF.bak-$(date +%Y%m%d-%H%M%S)"
cp -a "$CONF" "$BACKUP"
log "已备份：$BACKUP"

set_conf() {
  local key="$1" value="$2"
  if grep -qE "^[[:space:]]*${key}[[:space:]]*=" "$CONF"; then
    sed -i -E "s|^[[:space:]]*${key}[[:space:]]*=.*|${key} = ${value}|" "$CONF"
  else
    printf '%s = %s\n' "$key" "$value" >>"$CONF"
  fi
}

for item in "${SETTINGS[@]}"; do
  set_conf "${item%%|*}" "${item##*|}"
done
log "配置已写入"

# ------------------------------------------------------------------ 重启前体检
if ! runuser -u postgres -- "$BIN/postgres" -D "$DATA_DIR" -C shared_buffers >/dev/null 2>&1; then
  warn "配置体检未通过，回滚"
  cp -a "$BACKUP" "$CONF"
  runuser -u postgres -- "$BIN/postgres" -D "$DATA_DIR" -C shared_buffers >/dev/null 2>&1 \
    && log "已回滚到原配置（未重启，实例仍在运行）" \
    || die "回滚后配置仍不合法，请手动检查 $CONF"
  exit 1
fi
log "配置体检通过"

# ------------------------------------------------------------------ 重启 + 失败回滚
log "重启 $UNIT ..."
restart_cluster || true
if ! wait_ready; then
  warn "重启后实例未就绪，自动回滚配置"
  cp -a "$BACKUP" "$CONF"
  restart_cluster || true
  if wait_ready; then
    log "已回滚并恢复运行；备份保留在 $BACKUP"
  else
    die "回滚后仍未就绪，请查 journalctl -u $UNIT（备份：$BACKUP）"
  fi
  exit 1
fi
log "实例已就绪"

# ------------------------------------------------------------------ 扩展 + 校验
if [[ $USE_EXTENSION -eq 1 ]]; then
  for db in $(runuser -u postgres -- "$BIN/psql" -p "$PORT" -tAc \
      "SELECT datname FROM pg_database WHERE NOT datistemplate" 2>/dev/null | tr -d '\r'); do
    runuser -u postgres -- "$BIN/psql" -p "$PORT" -d "$db" -q -c \
      "CREATE EXTENSION IF NOT EXISTS pg_stat_statements" >/dev/null 2>&1 \
      && log "已确保扩展存在：$db"
  done
fi

echo
log "生效结果："
runuser -u postgres -- "$BIN/psql" -p "$PORT" -c \
  "SELECT name, setting, coalesce(unit,'') AS unit, source
     FROM pg_settings
    WHERE name IN ('max_connections','shared_buffers','effective_cache_size','maintenance_work_mem',
                   'work_mem','wal_buffers','random_page_cost','effective_io_concurrency',
                   'wal_compression','io_method','shared_preload_libraries','huge_pages','jit')
    ORDER BY name" || true

echo
log "内存现状（确认没有开始吃 swap）："
free -m || true
swapon --show || true

cat <<EOF

完成。后续：
  回滚配置      sudo bash $0 --rollback
  看慢查询      sudo -u postgres psql -d <业务库> -c "SELECT calls, round(total_exec_time::numeric,1) AS ms, left(query,100) FROM pg_stat_statements ORDER BY total_exec_time DESC LIMIT 10"
  看错误日志    journalctl -u $UNIT --since '10 min ago' | grep -iE "error|fatal"
  配置备份      $BACKUP
EOF
