import { describe, expect, it } from "vitest"

import { evaluateFence, resolveFenceTransition } from "@/lib/geofence"

const fence = {
  id: "fence-1",
  name: "第一监狱电子围栏",
  latitude: 39.9042,
  longitude: 116.4074,
  radiusMeters: 500,
  coordinateSystem: "GCJ02" as const,
  enabled: true,
}

describe("electronic fence", () => {
  it("only evaluates people currently in custody", () => {
    expect(
      evaluateFence({
        fence,
        point: { latitude: 39.99, longitude: 116.5 },
        isInCustody: false,
      }),
    ).toEqual({ verdict: "NOT_APPLICABLE", distanceMeters: null })
  })

  it("detects points inside and outside a radius", () => {
    expect(
      evaluateFence({
        fence,
        point: { latitude: 39.9042, longitude: 116.4074 },
        isInCustody: true,
      }),
    ).toEqual({ verdict: "INSIDE", distanceMeters: 0 })
    const outside = evaluateFence({
      fence,
      point: { latitude: 39.9142, longitude: 116.4074 },
      isInCustody: true,
    })
    expect(outside.verdict).toBe("OUTSIDE")
    expect(outside.distanceMeters).toBeGreaterThan(fence.radiusMeters)
  })

  it("does not evaluate when no active configuration exists", () => {
    expect(
      evaluateFence({
        fence: null,
        point: { latitude: 39.9042, longitude: 116.4074 },
        isInCustody: true,
      }),
    ).toEqual({ verdict: "NOT_CONFIGURED", distanceMeters: null })
  })

  it("derives entry and exit from consecutive reports", () => {
    expect(
      resolveFenceTransition({ previousInside: true, verdict: "OUTSIDE" }),
    ).toBe("EXIT")
    expect(
      resolveFenceTransition({ previousInside: false, verdict: "INSIDE" }),
    ).toBe("ENTER")
    expect(
      resolveFenceTransition({ previousInside: null, verdict: "OUTSIDE" }),
    ).toBe("INITIAL_OUTSIDE")
    expect(
      resolveFenceTransition({ previousInside: false, verdict: "OUTSIDE" }),
    ).toBe("OUTSIDE")
  })
})
