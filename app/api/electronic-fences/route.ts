import { failure, success } from "@/lib/api-response"
import {
  getCurrentElectronicFence,
  getLatestElectronicFenceLocation,
} from "@/lib/electronic-fence"
import { getSessionUser } from "@/lib/session"

function serializeFence(
  fence: NonNullable<Awaited<ReturnType<typeof getCurrentElectronicFence>>>,
) {
  return {
    id: fence.id,
    name: fence.name,
    latitude: Number(fence.latitude),
    longitude: Number(fence.longitude),
    radiusMeters: fence.radiusMeters,
    boundaryPoints: fence.boundaryPoints ?? [],
    coordinateSystem: fence.coordinateSystem,
    updatedAt: fence.updatedAt,
  }
}

export async function GET() {
  const actor = await getSessionUser()
  if (!actor) return failure("UNAUTHORIZED", "请先登录", 401)
  const [fence, latestLocation] = await Promise.all([
    getCurrentElectronicFence(actor.id),
    actor.role === "SUPERVISED"
      ? getLatestElectronicFenceLocation(actor.id)
      : Promise.resolve(null),
  ])
  return success(
    fence
      ? {
          ...serializeFence(fence),
          latestLocation: latestLocation
            ? {
                reportedAt: latestLocation.reportedAt,
                verdict: latestLocation.insideFence,
                transition: latestLocation.transition,
              }
            : null,
        }
      : null,
  )
}
