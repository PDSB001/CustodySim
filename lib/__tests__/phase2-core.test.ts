import { describe, expect, it } from "vitest"
import { expandRuleTargets, resolveScopes } from "@/lib/rule-engine"
import { computeCycle, computeDeadline, parseSlots } from "@/lib/rule-cycle"
import { resolveByUserFirst } from "@/lib/supervision-resolution"
import { buildOrgDescendantsMap } from "@/lib/supervision-scope"

describe("Phase 2 core logic", () => {
  const organizations = [
    { id: "root", parentId: null },
    { id: "ward", parentId: "root" },
    { id: "room", parentId: "ward" },
  ]

  it("expands organization descendants including itself", () => {
    const map = buildOrgDescendantsMap(organizations)
    expect([...(map.get("root") ?? [])]).toEqual(["root", "ward", "room"])
    expect([...(map.get("ward") ?? [])]).toEqual(["ward", "room"])
    expect([...(map.get("room") ?? [])]).toEqual(["room"])
  })

  it("prioritizes explicitly assigned rule scopes", () => {
    expect(
      resolveScopes({
        ownScopes: [{ targetType: "USER", targetId: "u1" }],
        groupScopes: [{ targetType: "ORG", targetId: "root" }],
      }),
    ).toEqual([{ targetType: "USER", targetId: "u1" }])
    expect(
      resolveScopes({
        ownScopes: [],
        groupScopes: [{ targetType: "ORG", targetId: "root" }],
      }),
    ).toEqual([{ targetType: "ORG", targetId: "root" }])
  })

  it("expands user and organization scopes to supervised users", () => {
    const map = buildOrgDescendantsMap(organizations)
    const targets = expandRuleTargets(
      [
        { targetType: "ORG", targetId: "ward" },
        { targetType: "USER", targetId: "u3" },
      ],
      map,
      [
        { id: "u1", organizationId: "room" },
        { id: "u2", organizationId: "root" },
        { id: "u3", organizationId: null },
      ],
    )
    expect([...targets].sort()).toEqual(["u1", "u3"])
  })

  it("keeps user-level relationship scopes ahead of organization scopes", () => {
    expect(
      resolveByUserFirst(
        [{ targetType: "USER", targetId: "u1" }],
        [{ targetType: "ORG", targetId: "root" }],
      ),
    ).toEqual([{ targetType: "USER", targetId: "u1" }])
  })

  it("parses valid time slots and computes cycles", () => {
    expect(parseSlots(["21:00", "09:30", "invalid", 2])).toEqual([
      "09:30",
      "21:00",
    ])
    expect(computeCycle("DAILY", new Date(2026, 7, 25))).toBe("2026-08-25")
    expect(computeCycle("MONTHLY", new Date(2026, 7, 25))).toBe("2026-08")
    expect(computeCycle("ONCE", new Date(2026, 7, 25))).toBe("once")
  })

  it("computes a deadline across midnight", () => {
    expect(
      computeDeadline(new Date("2026-08-25T21:00:00+08:00"), 300).toISOString(),
    ).toBe("2026-08-25T18:00:00.000Z")
  })
})
