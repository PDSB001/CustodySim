import { describe, expect, it } from "vitest"
import { resolveE2eDatabaseTarget } from "../../scripts/e2e-database-target.mjs"

const businessDatabaseUrl = "postgresql://business:pw@db.example:5432/custodysim"

describe("E2E database target", () => {
  it("derives the isolated database on the business server by default", () => {
    const target = resolveE2eDatabaseTarget({ businessDatabaseUrl })
    expect(target.e2eUrl.toString()).toBe(
      "postgresql://business:pw@db.example:5432/custodysim_e2e",
    )
    expect(target.maintenanceUrl.pathname).toBe("/postgres")
  })

  it("uses the explicit E2E server for creation and initialization", () => {
    const target = resolveE2eDatabaseTarget({
      businessDatabaseUrl,
      explicitE2eDatabaseUrl:
        "postgresql://tester:pw@test-db.example:6432/custodysim_e2e?sslmode=require",
    })
    expect(target.e2eUrl.hostname).toBe("test-db.example")
    expect(target.e2eUrl.port).toBe("6432")
    expect(target.maintenanceUrl.hostname).toBe("test-db.example")
    expect(target.maintenanceUrl.search).toBe("?sslmode=require")
  })

  it("rejects a production name in the explicit test URL", () => {
    expect(() =>
      resolveE2eDatabaseTarget({
        businessDatabaseUrl,
        explicitE2eDatabaseUrl:
          "postgresql://tester:pw@test-db.example:6432/custodysim",
      }),
    ).toThrow("E2E_DATABASE_URL 必须指向 custodysim_e2e")
  })

  it("rejects reusing the business database as the test database", () => {
    expect(() =>
      resolveE2eDatabaseTarget({
        businessDatabaseUrl:
          "postgresql://business:pw@db.example:5432/custodysim_e2e",
      }),
    ).toThrow("E2E 数据库不能与业务数据库同名")
  })
})
