import { describe, expect, it } from "vitest"

import {
  buildProfileReviewerIds,
  isEditableProfileRecord,
  resolveProfileReviewTransition,
} from "@/lib/profile-record"
import { ProfileRecordDraftSchema } from "@/lib/admin-schemas"

describe("profile record workflow", () => {
  it("routes every submission to the management office, after any supervisors", () => {
    expect(
      buildProfileReviewerIds({
        supervisorIds: ["supervisor-b", "supervisor-a"],
        adminId: "admin",
      }),
    ).toEqual(["supervisor-a", "supervisor-b", "admin"])
    expect(
      buildProfileReviewerIds({ supervisorIds: [], adminId: "admin" }),
    ).toEqual(["admin"])
  })

  it("only permits editing drafts and returned records", () => {
    expect(isEditableProfileRecord("DRAFT")).toBe(true)
    expect(isEditableProfileRecord("RETURNED")).toBe(true)
    expect(isEditableProfileRecord("PENDING_REVIEW")).toBe(false)
    expect(isEditableProfileRecord("LOCKED")).toBe(false)
  })

  it("returns a record to its owner when any reviewer returns it", () => {
    expect(
      resolveProfileReviewTransition({
        result: "RETURNED",
        hasNextReviewer: true,
      }),
    ).toEqual({ recordStatus: "RETURNED", activateNextReview: false })
  })

  it("activates exactly the next reviewer after a non-final approval", () => {
    expect(
      resolveProfileReviewTransition({
        result: "APPROVED",
        hasNextReviewer: true,
      }),
    ).toEqual({ recordStatus: "PENDING_REVIEW", activateNextReview: true })
  })

  it("locks the record after the final approval", () => {
    expect(
      resolveProfileReviewTransition({
        result: "APPROVED",
        hasNextReviewer: false,
      }),
    ).toEqual({ recordStatus: "LOCKED", activateNextReview: false })
  })

  it("accepts an optional supported photo data URL", () => {
    expect(
      ProfileRecordDraftSchema.safeParse({
        formId: "8e6e8302-3596-43da-a9f0-a176a9a48b74",
        data: {},
        photoData: "data:image/jpeg;base64,YQ==",
      }).success,
    ).toBe(true)
  })

  it("rejects an unsupported photo payload", () => {
    expect(
      ProfileRecordDraftSchema.safeParse({
        formId: "8e6e8302-3596-43da-a9f0-a176a9a48b74",
        data: {},
        photoData: "data:image/gif;base64,YQ==",
      }).success,
    ).toBe(false)
  })
})
