#!/usr/bin/env node
/**
 * 临时运维脚本：查看 / 重置指定账号的双重验证（MFA）。
 *
 * 用途：丢失验证器与恢复码时，解除二次验证锁定。
 * 用法：
 *   node --env-file=.env.local reset-mfa.mjs                  # 只查询状态（默认）
 *   node --env-file=.env.local reset-mfa.mjs <用户名> --apply  # 执行重置
 *
 * 注意：这是权限敏感操作，仅限开发 / 测试库。
 * 生产环境应走恢复码，或由管理员重置密码后重新绑定，不要使用本脚本。
 */
import pg from "pg"

const { Client } = pg

const [username, ...flags] = process.argv.slice(2)
const apply = flags.includes("--apply")

if (!username) {
  console.error(
    "用法: node --env-file=.env.local reset-mfa.mjs <用户名> [--apply]",
  )
  process.exit(1)
}

if (process.env.NODE_ENV === "production") {
  console.error(
    "拒绝执行：当前 NODE_ENV=production。MFA 重置不得在生产环境运行。",
  )
  process.exit(1)
}

if (!process.env.DATABASE_URL) {
  console.error("缺少 DATABASE_URL，请用 --env-file=.env.local 运行本脚本。")
  process.exit(1)
}

const client = new Client({ connectionString: process.env.DATABASE_URL })

try {
  await client.connect()

  const database = await client.query("select current_database() as name")
  console.log(`目标库: ${database.rows[0]?.name}`)

  const found = await client.query(
    "select id, username, role, status from users where username = $1",
    [username],
  )
  if (!found.rows.length) {
    console.error(`未找到账号 ${username}`)
    process.exitCode = 1
  } else {
    const target = found.rows[0]
    console.log(`账号: ${target.username}（${target.role}，${target.status}）`)

    const factors = await client.query(
      `select f.enabled,
              f.verified_at is not null as verified,
              (select count(*) from mfa_recovery_codes c where c.factor_id = f.id) as recovery_codes,
              (select count(*) from mfa_trusted_devices d
                where d.user_id = f.user_id and d.revoked_at is null) as trusted_devices
         from mfa_factors f
        where f.user_id = $1`,
      [target.id],
    )

    if (!factors.rows.length) {
      console.log(
        "该账号没有任何 MFA 记录 —— 登录不需要验证码，问题不在这里。",
      )
    } else {
      console.table(factors.rows)

      if (!apply) {
        console.log(
          "\n以上仅为查询。确认要重置请追加 --apply（会删除 MFA 记录与恢复码）。",
        )
      } else {
        const removed = await client.query(
          "delete from mfa_factors where user_id = $1",
          [target.id],
        )
        console.log(
          `\n已删除 MFA 记录 ${removed.rowCount} 条，恢复码随外键级联删除。`,
        )
        console.log(
          "受信任设备行会保留但已失效：免验证的前提是“存在已启用的 MFA 记录”。",
        )
        console.log(
          "下次登录不再要求验证码，可在 /security 页面用新验证器重新绑定。",
        )
      }
    }
  }
} catch (error) {
  console.error("执行失败:", error instanceof Error ? error.message : error)
  process.exitCode = 1
} finally {
  await client.end()
}
