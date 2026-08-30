import { describe, expect, it } from "vitest"

import { CustodyProfileSchema } from "@/lib/custody-profile-schema"

describe("监管档案响应结构", () => {
  it("在页面间共享缓存时保留打卡与围栏判定字段", () => {
    const profile = CustodyProfileSchema.parse({
      custodyLevel: "GENERAL",
      custodyStatus: "IN_CUSTODY",
      canCheckin: true,
      leaveWorkflowEligible: true,
      geofenceApplicable: true,
    })

    expect(profile).toMatchObject({
      canCheckin: true,
      leaveWorkflowEligible: true,
      geofenceApplicable: true,
    })
  })

  it("支持禁闭状态", () => {
    expect(
      CustodyProfileSchema.parse({
        custodyLevel: "STRICT",
        custodyStatus: "ISOLATION",
        canCheckin: true,
        leaveWorkflowEligible: false,
        geofenceApplicable: true,
      }).custodyStatus,
    ).toBe("ISOLATION")
  })
})
