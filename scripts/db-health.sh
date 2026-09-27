#!/usr/bin/env bash
# 全库体检（严格只读）。
#
# 只发 SELECT / 统计函数调用，不写数据、不做 DDL、不改任何配置（包括不改日志参数）。
# 需要 psql 客户端；服务器上一般已自带（apt install postgresql-client 可补）。
#
#   bash scripts/db-health.sh                          # 连 .env.local 里的 DATABASE_URL
#   bash scripts/db-health.sh --database=custodysim    # 先校验库名，防止连错库
#   DATABASE_URL=postgres://... bash scripts/db-health.sh
#   bash scripts/db-health.sh --help
set -uo pipefail

usage() {
  cat <<'EOF'
bash scripts/db-health.sh [--database=<期望的库名>] [--help]

  --database=NAME  连接后校验 current_database()，不一致就中止（防止对着错库跑）
  --help           显示本帮助

连接串来源：环境变量 DATABASE_URL，其次 .env.local（脚本不会打印连接串本身）。
本脚本严格只读：仅 SELECT 与统计函数，不写数据、不做 DDL。
EOF
}

EXPECTED_DB=""
for arg in "$@"; do
  case "$arg" in
    --database=*) EXPECTED_DB="${arg#--database=}" ;;
    -h|--help) usage; exit 0 ;;
    *) echo "未知参数：$arg（用 --help 查看用法）" >&2; exit 2 ;;
  esac
done

if [[ -z "${DATABASE_URL:-}" && -f .env.local ]]; then
  DATABASE_URL="$(sed -n 's/^[[:space:]]*\(export[[:space:]]\+\)\?DATABASE_URL[[:space:]]*=[[:space:]]*"\?\([^"[:space:]]*\)"\?.*$/\2/p' .env.local | head -n 1)"
fi
if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "缺少 DATABASE_URL：请设置环境变量，或在仓库根目录的 .env.local 中配置。" >&2
  exit 1
fi
if ! command -v psql >/dev/null 2>&1; then
  echo "未找到 psql 客户端。请在装 PostgreSQL 的机器上运行，或安装 postgresql-client。" >&2
  exit 1
fi

# 只解析出 host / db 用于打印，绝不回显完整连接串（含密码）。
URL_HOST="$(printf '%s' "$DATABASE_URL" | sed -E 's#^[a-zA-Z]+://([^@/]*@)?([^/:?]+).*#\2#')"
URL_DB="$(printf '%s' "$DATABASE_URL" | sed -E 's#^[a-zA-Z]+://[^?]*/([^?]*).*#\1#')"

PSQL=(psql "$DATABASE_URL" -X -q -v ON_ERROR_STOP=0 -P pager=off)
section() { printf '\n\033[1m===== %s =====\033[0m\n' "$1"; }
q() { "${PSQL[@]}" -c "$1"; }

section "0. 连接与目标"
echo "host=${URL_HOST:-?}  db=${URL_DB:-?}"
ACTUAL_DB="$("${PSQL[@]}" -tA -c 'select current_database()')"
echo "current_database() = ${ACTUAL_DB:-连接失败}"
if [[ -n "$EXPECTED_DB" && "$ACTUAL_DB" != "$EXPECTED_DB" ]]; then
  echo "库名不符（期望 $EXPECTED_DB）：已中止，未做任何查询。" >&2
  exit 1
fi

section "1. 版本与相关配置"
q "select version();"
q "select name, setting from pg_settings
   where name in ('shared_preload_libraries','log_min_duration_statement','max_connections',
                  'autovacuum','work_mem','effective_cache_size','max_wal_size')
   order by name;"

section "2. 表与索引用量（含 TOAST 占比）"
q "select c.relname as 表,
          pg_size_pretty(pg_total_relation_size(c.oid)) as 合计,
          pg_size_pretty(pg_relation_size(c.oid)) as 主表,
          pg_size_pretty(pg_indexes_size(c.oid)) as 索引,
          -- 大字段（base64 图片、jsonb 快照）走 TOAST，这一列才看得出来
          pg_size_pretty(pg_total_relation_size(c.oid) - pg_relation_size(c.oid) - pg_indexes_size(c.oid)) as toast,
          c.reltuples::bigint as 估算行数
   from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r'
   order by pg_total_relation_size(c.oid) desc limit 20;"

section "3. 本项目关键表速览"
q "select 'checkin_records' as 表, count(*) as 行数, pg_size_pretty(pg_total_relation_size('public.checkin_records')) as 合计 from checkin_records
   union all select 'checkin_tasks', count(*), pg_size_pretty(pg_total_relation_size('public.checkin_tasks')) from checkin_tasks
   union all select 'checkin_makeups', count(*), pg_size_pretty(pg_total_relation_size('public.checkin_makeups')) from checkin_makeups
   union all select 'report_tasks', count(*), pg_size_pretty(pg_total_relation_size('public.report_tasks')) from report_tasks
   union all select 'report_submissions', count(*), pg_size_pretty(pg_total_relation_size('public.report_submissions')) from report_submissions
   union all select 'report_reviews', count(*), pg_size_pretty(pg_total_relation_size('public.report_reviews')) from report_reviews
   union all select 'chat_messages', count(*), pg_size_pretty(pg_total_relation_size('public.chat_messages')) from chat_messages
   order by 行数 desc;"

section "4. 大字段实况（行太胖是最容易拖慢接口的地方）"
q "select 'checkin_records.photo_url' as 字段, count(*) filter (where photo_url is not null) as 非空行数,
          pg_size_pretty(coalesce(sum(pg_column_size(photo_url)), 0)::bigint) as 合计,
          pg_size_pretty(coalesce(max(pg_column_size(photo_url)), 0)::bigint) as 单行最大
   from checkin_records
   union all select 'report_reviews.submitted_snapshot', count(*) filter (where submitted_snapshot is not null),
          pg_size_pretty(coalesce(sum(pg_column_size(submitted_snapshot)), 0)::bigint),
          pg_size_pretty(coalesce(max(pg_column_size(submitted_snapshot)), 0)::bigint)
   from report_reviews
   union all select 'report_submissions.data', count(*) filter (where data is not null),
          pg_size_pretty(coalesce(sum(pg_column_size(data)), 0)::bigint),
          pg_size_pretty(coalesce(max(pg_column_size(data)), 0)::bigint)
   from report_submissions
   union all select 'report_submissions.content', count(*) filter (where content is not null),
          pg_size_pretty(coalesce(sum(pg_column_size(content)), 0)::bigint),
          pg_size_pretty(coalesce(max(pg_column_size(content)), 0)::bigint)
   from report_submissions
   union all select 'chat_messages.content', count(*) filter (where content is not null),
          pg_size_pretty(coalesce(sum(pg_column_size(content)), 0)::bigint),
          pg_size_pretty(coalesce(max(pg_column_size(content)), 0)::bigint)
   from chat_messages;"

section "5. 顺序扫描最多的表（数据量上来后最先出问题的信号）"
q "select relname as 表, seq_scan as 顺序扫描, seq_tup_read as 扫过的行,
          idx_scan as 索引扫描, n_live_tup as 存活行数, n_dead_tup as 死行
   from pg_stat_user_tables
   order by seq_tup_read desc limit 15;"

section "6. 索引使用情况与未使用索引"
q "select s.relname as 索引, t.relname as 表, i.indisunique as 唯一约束,
          s.idx_scan as 使用次数,
          pg_size_pretty(pg_relation_size(s.indexrelid)) as 大小
   from pg_stat_user_indexes s
   join pg_class t on t.oid = s.relid
   join pg_index i on i.indexrelid = s.indexrelid
   where s.idx_scan = 0
   order by pg_relation_size(s.indexrelid) desc limit 20;"
echo "（注意：唯一索引/主键即使 idx_scan=0 也承担约束职责，不能因为「没被扫过」就删。）"

section "7. 死元组与自动清理健康度"
q "select relname as 表, n_live_tup as 存活行, n_dead_tup as 死行,
          last_vacuum, last_autovacuum, last_analyze, last_autoanalyze
   from pg_stat_user_tables
   order by n_dead_tup desc limit 15;"

section "8. 当前活动、长事务与阻塞"
q "select pid, state, wait_event_type, wait_event,
          round(extract(epoch from (now() - xact_start))) as 事务秒数,
          round(extract(epoch from (now() - query_start))) as 查询秒数,
          left(regexp_replace(query, '\s+', ' ', 'g'), 90) as 语句
   from pg_stat_activity
   where datname = current_database() and pid <> pg_backend_pid()
   order by xact_start nulls last limit 15;"
q "select pid, pg_blocking_pids(pid) as 被谁阻塞, left(regexp_replace(query, '\s+', ' ', 'g'), 90) as 语句
   from pg_stat_activity
   where cardinality(pg_blocking_pids(pid)) > 0;"
q "select count(*) as 连接数, (select setting::int from pg_settings where name = 'max_connections') as 上限
   from pg_stat_activity where datname = current_database();"

section "9. 慢查询统计（需要 pg_stat_statements）"
HAS_STATS="$("${PSQL[@]}" -tA -c "select count(*) from pg_extension where extname = 'pg_stat_statements'")"
echo "（若结果里出现 <insufficient privilege>：当前连接角色看不到应用角色执行的语句；"
echo "  换成应用角色或超级用户重跑本脚本，才能看到应用侧的完整排行。）"
if [[ "$HAS_STATS" == "1" ]]; then
  echo "-- 按平均耗时排序"
  q "select calls as 次数, round(total_exec_time::numeric, 1) as 总毫秒,
            round(mean_exec_time::numeric, 2) as 平均毫秒, rows as 平均返回行,
            left(regexp_replace(query, '\s+', ' ', 'g'), 100) as 语句
     from pg_stat_statements
     where query not ilike '%pg_stat_statements%'
     order by mean_exec_time desc limit 15;"
  echo "-- 按累计耗时排序"
  q "select calls as 次数, round(total_exec_time::numeric, 1) as 总毫秒,
            round(mean_exec_time::numeric, 2) as 平均毫秒,
            left(regexp_replace(query, '\s+', ' ', 'g'), 100) as 语句
     from pg_stat_statements
     where query not ilike '%pg_stat_statements%'
     order by total_exec_time desc limit 15;"
else
  echo "未安装 pg_stat_statements（PG 默认不装，需 shared_preload_libraries + CREATE EXTENSION）。"
  echo "本次跳过；上面的「顺序扫描」与「活动/阻塞」两段已能覆盖大部分排查需求。"
  echo "若要长期统计慢语句，可在维护窗口执行："
  echo "  ALTER SYSTEM SET shared_preload_libraries = 'pg_stat_statements';  # 需重启"
  echo "  CREATE EXTENSION IF NOT EXISTS pg_stat_statements;"
  echo "  ALTER SYSTEM SET log_min_duration_statement = '500ms';  SELECT pg_reload_conf();"
fi

printf '\n体检结束（全程只读）。\n'
