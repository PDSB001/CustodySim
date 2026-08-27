export type GeoPoint = { latitude: number; longitude: number }

export type ElectronicFenceShape = GeoPoint & {
  id: string
  name: string
  radiusMeters: number
  coordinateSystem: "GCJ02"
  enabled: boolean
}

export type GeofenceVerdict =
  | "INSIDE"
  | "OUTSIDE"
  | "NOT_CONFIGURED"
  | "NOT_APPLICABLE"

export type FenceTransition =
  | "INITIAL_INSIDE"
  | "INITIAL_OUTSIDE"
  | "ENTER"
  | "EXIT"
  | "INSIDE"
  | "OUTSIDE"
  | "NOT_APPLICABLE"
  | "NOT_CONFIGURED"

const EARTH_RADIUS_METERS = 6_371_008.8

function radians(value: number) {
  return (value * Math.PI) / 180
}

export function distanceMeters(from: GeoPoint, to: GeoPoint) {
  const latDelta = radians(to.latitude - from.latitude)
  const lngDelta = radians(to.longitude - from.longitude)
  const a =
    Math.sin(latDelta / 2) ** 2 +
    Math.cos(radians(from.latitude)) *
      Math.cos(radians(to.latitude)) *
      Math.sin(lngDelta / 2) ** 2
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.sqrt(a))
}

export function evaluateFence({
  fence,
  point,
  isInCustody,
}: {
  fence: ElectronicFenceShape | null
  point: GeoPoint
  isInCustody: boolean
}): { verdict: GeofenceVerdict; distanceMeters: number | null } {
  if (!isInCustody) return { verdict: "NOT_APPLICABLE", distanceMeters: null }
  if (!fence || !fence.enabled)
    return { verdict: "NOT_CONFIGURED", distanceMeters: null }
  const measured = distanceMeters(fence, point)
  return {
    verdict: measured <= fence.radiusMeters ? "INSIDE" : "OUTSIDE",
    distanceMeters: Math.round(measured),
  }
}

export function resolveFenceTransition({
  previousInside,
  verdict,
}: {
  previousInside: boolean | null
  verdict: GeofenceVerdict
}): FenceTransition {
  if (verdict === "NOT_APPLICABLE") return "NOT_APPLICABLE"
  if (verdict === "NOT_CONFIGURED") return "NOT_CONFIGURED"
  const inside = verdict === "INSIDE"
  if (previousInside === null)
    return inside ? "INITIAL_INSIDE" : "INITIAL_OUTSIDE"
  if (previousInside && !inside) return "EXIT"
  if (!previousInside && inside) return "ENTER"
  return inside ? "INSIDE" : "OUTSIDE"
}
