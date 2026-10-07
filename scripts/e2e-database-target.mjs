/**
 * Resolve the one allowed E2E database before opening any PostgreSQL connection.
 *
 * @param {{ businessDatabaseUrl: string | undefined, explicitE2eDatabaseUrl?: string, databaseName?: string }} options
 */
export function resolveE2eDatabaseTarget({
  businessDatabaseUrl,
  explicitE2eDatabaseUrl = undefined,
  databaseName = "custodysim_e2e",
}) {
  if (databaseName !== "custodysim_e2e")
    throw new Error("E2E 初始化只能操作 custodysim_e2e 隔离数据库")
  if (!businessDatabaseUrl) throw new Error(".env.local 未配置 DATABASE_URL")

  const businessUrl = new URL(businessDatabaseUrl)
  if (decodeURIComponent(businessUrl.pathname.slice(1)) === databaseName)
    throw new Error("E2E 数据库不能与业务数据库同名")

  const e2eUrl = new URL(explicitE2eDatabaseUrl ?? businessDatabaseUrl)
  if (explicitE2eDatabaseUrl) {
    if (decodeURIComponent(e2eUrl.pathname.slice(1)) !== databaseName)
      throw new Error("E2E_DATABASE_URL 必须指向 custodysim_e2e 隔离数据库")
  } else {
    e2eUrl.pathname = `/${databaseName}`
  }

  const maintenanceUrl = new URL(e2eUrl)
  maintenanceUrl.pathname = "/postgres"
  return { databaseName, e2eUrl, maintenanceUrl }
}
