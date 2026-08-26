export type ProfileRecordStatus =
  "DRAFT" | "PENDING_REVIEW" | "RETURNED" | "LOCKED"

export type ProfileReviewResult = "APPROVED" | "RETURNED"

export function isEditableProfileRecord(status: string) {
  return status === "DRAFT" || status === "RETURNED"
}

export function buildProfileReviewerIds({
  supervisorIds,
  adminId,
}: {
  supervisorIds: string[]
  adminId: string
}) {
  return [...new Set([...supervisorIds.sort(), adminId])]
}

export function resolveProfileReviewTransition({
  result,
  hasNextReviewer,
}: {
  result: ProfileReviewResult
  hasNextReviewer: boolean
}) {
  if (result === "RETURNED")
    return { recordStatus: "RETURNED" as const, activateNextReview: false }
  if (hasNextReviewer)
    return {
      recordStatus: "PENDING_REVIEW" as const,
      activateNextReview: true,
    }
  return { recordStatus: "LOCKED" as const, activateNextReview: false }
}
