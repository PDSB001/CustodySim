/** Rechecks current chat scope at delivery time. Keep aligned with lib/chat-server.ts. */
export async function canReceiveChat(pool, userId, conversationId) {
  const { rows } = await pool.query(
    `SELECT u.role,u.organization_id,c.type,c.room_organization_id FROM users u
    CROSS JOIN chat_conversations c WHERE u.id=$1 AND u.status='active' AND c.id=$2 AND c.status='ACTIVE'`,
    [userId, conversationId],
  )
  const actor = rows[0]
  if (!actor) return false
  if (actor.role === "ADMIN") return true
  if (actor.role === "SUPERVISED") {
    if (actor.type !== "ROOM") return true // Worker already requires active membership.
    const occupants = await pool.query(
      "SELECT 1 FROM persons WHERE user_id=$1 AND organization_id=$2 AND person_type='SUPERVISED' AND status='active'",
      [userId, actor.room_organization_id],
    )
    return occupants.rowCount > 0
  }
  const [organizations, accounts, relations, scopes, participants] =
    await Promise.all([
      pool.query("SELECT id,parent_id FROM organizations"),
      pool.query(
        "SELECT id,organization_id FROM users WHERE role='SUPERVISED' AND status='active'",
      ),
      pool.query(
        "SELECT id FROM supervision_relations WHERE status='active' AND (start_date IS NULL OR start_date<=now()) AND (end_date IS NULL OR end_date>=now())",
      ),
      pool.query(
        "SELECT relation_id,side,target_type,target_id FROM supervision_relation_scopes",
      ),
      actor.type === "ROOM"
        ? pool.query(
            "SELECT user_id AS id FROM persons WHERE organization_id=$1 AND person_type='SUPERVISED' AND status='active'",
            [actor.room_organization_id],
          )
        : pool.query(
            "SELECT user_id AS id FROM chat_conversation_members WHERE conversation_id=$1 AND left_at IS NULL",
            [conversationId],
          ),
    ])
  function matches(scope, account) {
    if (scope.target_type === "USER") return scope.target_id === account.id
    let id = account.organization_id
    const seen = new Set()
    while (id && !seen.has(id)) {
      if (id === scope.target_id) return true
      seen.add(id)
      id = organizations.rows.find((org) => org.id === id)?.parent_id
    }
    return false
  }
  const permitted = new Set()
  for (const relation of relations.rows) {
    const current = scopes.rows.filter(
      (scope) => scope.relation_id === relation.id,
    )
    if (
      !current.some(
        (scope) =>
          scope.side === "SUPERVISOR" &&
          matches(scope, {
            id: userId,
            organization_id: actor.organization_id,
          }),
      )
    )
      continue
    for (const account of accounts.rows)
      if (
        current.some(
          (scope) => scope.side === "SUPERVISED" && matches(scope, account),
        )
      )
        permitted.add(account.id)
  }
  return (
    participants.rows.length > 0 &&
    participants.rows.every((participant) => permitted.has(participant.id))
  )
}
