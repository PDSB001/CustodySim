import { createHash } from "node:crypto"
import { canReceiveChat } from "./push-chat-access.mjs"

/** Pure payload builder: message bodies and attachments never leave our server. */
export function providerPayload(delivery, token, appkey, now = Date.now()) {
  const title =
    delivery.kind === "CHAT"
      ? delivery.senderName.slice(0, 60)
      : delivery.kind === "CHECKIN"
        ? "打卡提醒"
        : delivery.kind === "TASK"
          ? "任务提醒"
          : delivery.kind === "COMMUNITY"
            ? "匿名社区"
            : delivery.kind === "PROBATION"
              ? "首周考察提醒"
              : "CustodySim 通知"
  const text =
    delivery.kind === "CHAT"
      ? "发来一条消息"
      : delivery.kind === "CHECKIN"
        ? "当前有待完成的打卡，请在截止前打开 App 完成"
        : delivery.kind === "TASK"
          ? taskNotificationText(delivery.taskEvent)
          : delivery.kind === "COMMUNITY"
            ? "你的帖子收到新评论，点击查看"
            : delivery.kind === "PROBATION"
              ? "首周考察即将结束，考察积分须大于 0，请及时查看"
              : "你有一条新通知，请打开 App 查看"
  return {
    appkey,
    timestamp: String(now),
    type: "unicast",
    device_tokens: token,
    production_mode: "true",
    payload: {
      display_type: "notification",
      body: { title, text, ticker: `${title}：${text}`, after_open: "go_app" },
      extra: delivery,
    },
    policy: {
      expire_time: new Date(
        Math.min(
          now + 3600_000,
          delivery.expiresAt ? Date.parse(delivery.expiresAt) : Infinity,
        ),
      ).toLocaleString("sv-SE", {
        timeZone: "Asia/Shanghai",
      }),
    },
  }
}

export function taskNotificationText(event) {
  return (
    {
      OPEN: "有新任务，请打开 App 查看",
      CLOSING: "有任务即将截止，请及时完成",
      RETURNED: "任务已退回，请查看原因并重新提交",
      APPROVED: "任务已通过审核，请打开 App 查看",
    }[event] ?? "任务状态已更新，请打开 App 查看"
  )
}

export async function sendUmeng(
  delivery,
  token,
  env = process.env,
  fetcher = fetch,
) {
  if (
    env.UMENG_PUSH_ENABLED !== "true" ||
    !env.UMENG_APP_KEY ||
    !env.UMENG_APP_MASTER_SECRET
  )
    throw new Error("PROVIDER_DISABLED")
  const url = "https://msgapi.umeng.com/api/send"
  const body = JSON.stringify(
    providerPayload(delivery, token, env.UMENG_APP_KEY),
  )
  const sign = createHash("md5")
    .update(`POST${url}${body}${env.UMENG_APP_MASTER_SECRET}`)
    .digest("hex")
  const response = await fetcher(`${url}?sign=${sign}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
    signal: AbortSignal.timeout(10_000),
  })
  const result = await response.json()
  if (!response.ok || result.ret !== "SUCCESS")
    throw new Error(
      `UMENG_${String(result.data?.error_code ?? response.status)
        .replace(/[^0-9]/g, "")
        .slice(0, 12)}`,
    )
}

export function startPushWorker(pool, io, { intervalMs = 5000 } = {}) {
  let running = false,
    stopped = false
  async function tick() {
    if (running || stopped) return
    running = true
    try {
      // Atomic lease permits several realtime processes without duplicate ownership.
      const claimed =
        await pool.query(`UPDATE push_deliveries SET state='PROCESSING', lease_until=now()+interval '45 seconds', attempts=attempts+1
        WHERE id IN (SELECT id FROM push_deliveries WHERE
          ((state='PENDING' AND available_at<=now()) OR (state='PROCESSING' AND lease_until<now()))
          ORDER BY available_at LIMIT 3 FOR UPDATE SKIP LOCKED) RETURNING *`)
      await Promise.all(
        claimed.rows.map(async (row) => {
          let state = "SKIPPED",
            errorCode = null
          try {
            const { rows: devices } = await pool.query(
              `SELECT d.*,u.role FROM push_devices d JOIN users u ON u.id=d.user_id
            WHERE d.id=$1 AND d.user_id=$2 AND d.binding_id=$3 AND d.enabled AND u.status='active' AND u.token_version=d.token_version`,
              [row.device_id, row.user_id, row.binding_id],
            )
            const device = devices[0]
            let eligible = false,
              senderName = "",
              conversationId = "",
              expiresAt = "",
              taskEvent = ""
            let postId = ""
            if (
              device &&
              Date.now() - new Date(row.created_at).getTime() < 3600_000
            ) {
              if (row.kind === "CHAT" && device.chat_enabled) {
                const found = await pool.query(
                  `SELECT coalesce(u.name,'联系人') AS name,m.conversation_id FROM chat_messages m
                LEFT JOIN users u ON u.id=m.sender_id JOIN chat_conversation_members cm ON cm.conversation_id=m.conversation_id AND cm.user_id=$2 AND cm.left_at IS NULL
                JOIN chat_conversations c ON c.id=m.conversation_id AND c.status='ACTIVE'
                WHERE m.id=$1 AND m.recalled_at IS NULL AND NOT EXISTS (SELECT 1 FROM chat_message_reads r WHERE r.message_id=m.id AND r.user_id=$2)
                AND NOT EXISTS (SELECT 1 FROM chat_notification_preferences p WHERE p.user_id=$2 AND p.conversation_id=m.conversation_id AND p.muted)`,
                  [row.entity_id, row.user_id],
                )
                eligible =
                  found.rowCount > 0 &&
                  (await canReceiveChat(
                    pool,
                    row.user_id,
                    found.rows[0].conversation_id,
                  ))
                senderName = found.rows[0]?.name ?? ""
                conversationId = found.rows[0]?.conversation_id ?? ""
              } else if (row.kind === "PROBATION" && device.notices_enabled) {
                const found = await pool.query(
                  "SELECT trial_end FROM registrations WHERE user_id=$1 AND state='PENDING' AND trial_end>now()",
                  [row.user_id],
                )
                eligible = row.entity_id === row.user_id && found.rowCount > 0
                if (eligible) expiresAt = found.rows[0].trial_end.toISOString()
              } else if (row.kind === "COMMUNITY" && device.community_enabled) {
                const found = await pool.query(
                  `SELECT c.post_id FROM community_comments c JOIN community_posts p ON p.id=c.post_id
                   WHERE c.id=$1 AND p.author_id=$2 AND c.author_id<>$2
                   AND NOT EXISTS (SELECT 1 FROM community_comment_reads r WHERE r.comment_id=c.id AND r.user_id=$2)`,
                  [row.entity_id, row.user_id],
                )
                eligible = found.rowCount > 0
                postId = found.rows[0]?.post_id ?? ""
              } else if (row.kind === "TASK" && device.tasks_enabled) {
                taskEvent = row.event_key.split(":")[2]
                const found = await pool.query(
                  `SELECT t.deadline FROM report_tasks t WHERE t.id=$1 AND t.supervised_id=$2 AND t.schedule_at<=now()
                   AND (( $3='OPEN' AND t.status='PENDING' AND t.deadline>now())
                     OR ($3='CLOSING' AND t.status IN ('PENDING','RETURNED') AND t.deadline>now())
                     OR ($3 IN ('RETURNED','APPROVED') AND t.status=$3 AND ($3='APPROVED' OR t.deadline>now())
                       AND ('TASK:'||t.id||':'||t.status||':'||to_char(t.updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))=$4))
                   AND (t.rule_id IS NULL OR EXISTS (SELECT 1 FROM rules r WHERE r.id=t.rule_id AND r.enabled))
                   AND NOT EXISTS (SELECT 1 FROM persons p WHERE p.user_id=t.supervised_id AND p.custody_status='ON_LEAVE'
                     AND t.template_snapshot->>'completionMode' IS DISTINCT FROM 'READING')`,
                  [row.entity_id, row.user_id, taskEvent, row.event_key],
                )
                eligible = device.role === "SUPERVISED" && found.rowCount > 0
                if (eligible && taskEvent !== "APPROVED")
                  expiresAt = found.rows[0].deadline.toISOString()
              } else if (
                row.kind === "CHECKIN" &&
                device.checkin_reminders_enabled
              ) {
                const found = await pool.query(
                  `SELECT t.deadline FROM checkin_tasks t
                   JOIN rules r ON r.id=t.rule_id AND r.enabled
                   JOIN persons p ON p.user_id=t.supervised_id AND p.person_type='SUPERVISED' AND p.status='active'
                   WHERE t.id=$1 AND t.supervised_id=$2 AND t.status='PENDING'
                   AND t.schedule_at<=now() AND t.deadline>now()
                   AND p.custody_status IN ('IN_CUSTODY','ISOLATION')
                   AND NOT EXISTS (SELECT 1 FROM checkin_records cr WHERE cr.task_id=t.id)`,
                  [row.entity_id, row.user_id],
                )
                eligible = device.role === "SUPERVISED" && found.rowCount > 0
                expiresAt = found.rows[0]?.deadline.toISOString() ?? ""
              } else if (row.kind === "NOTICE" && device.notices_enabled) {
                const found = await pool.query(
                  `SELECT id FROM notices n WHERE id=$1 AND published AND (expires_at IS NULL OR expires_at>now())
                AND (target_role='ALL' OR target_role=$2) AND NOT EXISTS (SELECT 1 FROM notice_reads r WHERE r.notice_id=n.id AND r.user_id=$3)
                AND ('NOTICE:'||id||':'||to_char(updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))=$4`,
                  [row.entity_id, device.role, row.user_id, row.event_key],
                )
                eligible = found.rowCount > 0
              }
            }
            if (eligible) {
              const payload = {
                deliveryId: row.id,
                deviceId: device.id,
                bindingId: device.binding_id,
                userId: row.user_id,
                kind: row.kind,
                entityId: row.entity_id,
                conversationId,
                senderName,
                ...(expiresAt ? { expiresAt } : {}),
                ...(taskEvent ? { taskEvent } : {}),
                ...(postId ? { postId } : {}),
              }
              const room = `device:${device.id}:${device.binding_id}`
              let received = false
              if (io.sockets.adapter.rooms.get(room)?.size) {
                try {
                  const replies = await io
                    .to(room)
                    .timeout(3000)
                    .emitWithAck("notification:delivery", payload)
                  received = replies.some((r) => r?.ok === true)
                } catch {
                  /* Provider fallback after missing acknowledgement. */
                }
              }
              if (received) state = "DIRECT"
              else if (device.provider_token) {
                await sendUmeng(payload, device.provider_token)
                state = "PUSH"
              }
            }
          } catch (error) {
            errorCode = /^(UMENG_\d+|PROVIDER_DISABLED)$/.test(error.message)
              ? error.message
              : "DELIVERY_FAILED"
            state = row.attempts < 5 ? "PENDING" : "FAILED"
          }
          await pool.query(
            `UPDATE push_deliveries SET state=$2,error_code=$3,lease_until=NULL,
          available_at=now()+interval '30 seconds',delivered_at=CASE WHEN $2::varchar IN ('DIRECT','PUSH') THEN now() ELSE NULL END WHERE id=$1 AND attempts=$4`,
            [row.id, state, errorCode, row.attempts],
          )
        }),
      )
      await pool.query(
        "DELETE FROM push_deliveries WHERE created_at<now()-interval '7 days' AND state NOT IN ('PENDING','PROCESSING')",
      )
    } catch {
      console.error("[push worker] queue unavailable; retrying")
    } finally {
      running = false
    }
  }
  const timer = setInterval(() => void tick(), intervalMs)
  timer.unref()
  return {
    wake: () => void tick(),
    stop: async () => {
      stopped = true
      clearInterval(timer)
      while (running) await new Promise((r) => setTimeout(r, 25))
    },
  }
}
