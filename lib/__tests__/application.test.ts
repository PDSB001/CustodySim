import { describe, expect, it } from "vitest"

import { ApplicationDraftSchema, ApplicationReviewSchema } from "@/lib/admin-schemas"
import {
  APPLICATION_TYPE_LABELS,
  buildApplicationReviewerIds,
  isLeaveActive,
  isTemporaryReleaseActive,
  isApplicationEditable,
  resolveApplicationReviewTransition,
} from "@/lib/application"

const archiveRecordId = "8e6e8302-3596-43da-a9f0-a176a9a48b74"

describe("application workflow", () => {
  it("uses stable labels for every supported application type", () => {
    expect(APPLICATION_TYPE_LABELS).toEqual({
      LEAVE: "请假申请",
      TEMPORARY_OUT_OF_CUSTODY: "临时离监申请",
      SENTENCE_REDUCTION: "减刑申请",
      GENERAL: "一般事项申请",
    })
  })

  it("routes applications through sorted supervisors and management office", () => {
    const supervisors = ["supervisor-b", "supervisor-a", "supervisor-a"]
    expect(
      buildApplicationReviewerIds({ supervisorIds: supervisors, adminId: "admin" }),
    ).toEqual(["supervisor-a", "supervisor-b", "admin"])
    expect(supervisors).toEqual(["supervisor-b", "supervisor-a", "supervisor-a"])
    expect(
      buildApplicationReviewerIds({ supervisorIds: [], adminId: "admin" }),
    ).toEqual(["admin"])
    expect(
      buildApplicationReviewerIds({
        supervisorIds: ["admin", "supervisor-a"],
        adminId: "admin",
      }),
    ).toEqual(["supervisor-a", "admin"])
  })

  it("only permits changes before submission or after return", () => {
    expect(isApplicationEditable("DRAFT")).toBe(true)
    expect(isApplicationEditable("RETURNED")).toBe(true)
    expect(isApplicationEditable("PENDING_REVIEW")).toBe(false)
    expect(isApplicationEditable("APPROVED")).toBe(false)
    expect(isApplicationEditable("REJECTED")).toBe(false)
  })

  it("returns or rejects an application without activating another reviewer", () => {
    expect(
      resolveApplicationReviewTransition({
        result: "RETURNED",
        hasNextReviewer: true,
        applicationType: "LEAVE",
      }),
    ).toEqual({ applicationStatus: "RETURNED", activateNextReview: false })
    expect(
      resolveApplicationReviewTransition({
        result: "REJECTED",
        hasNextReviewer: true,
        applicationType: "GENERAL",
      }),
    ).toEqual({ applicationStatus: "REJECTED", activateNextReview: false })
  })

  it("activates only the next reviewer after a non-final approval", () => {
    expect(
      resolveApplicationReviewTransition({
        result: "APPROVED",
        hasNextReviewer: true,
        applicationType: "LEAVE",
      }),
    ).toEqual({ applicationStatus: "PENDING_REVIEW", activateNextReview: true })
  })

  it("updates custody status only after final leave approval", () => {
    expect(
      resolveApplicationReviewTransition({
        result: "APPROVED",
        hasNextReviewer: false,
        applicationType: "LEAVE",
      }),
    ).toEqual({
      applicationStatus: "APPROVED",
      activateNextReview: false,
      custodyStatus: "ON_LEAVE",
    })
    expect(
      resolveApplicationReviewTransition({
        result: "APPROVED",
        hasNextReviewer: false,
        applicationType: "SENTENCE_REDUCTION",
      }),
    ).toEqual({
      applicationStatus: "APPROVED",
      activateNextReview: false,
      custodyStatus: null,
    })
  })

  it("recognizes only the approved moment range as temporary release", () => {
    const payload = {
      temporaryReleaseStartAt: "2026-08-26T16:00:00+08:00",
      temporaryReleaseEndAt: "2026-08-28T16:00:00+08:00",
    }
    // 区间内（按 UTC 看，16:00+08:00 = 08:00 UTC）
    expect(
      isTemporaryReleaseActive(payload, new Date("2026-08-27T00:00:00.000Z")),
    ).toBe(true)
    // 区间外：晚于 endAt
    expect(
      isTemporaryReleaseActive(payload, new Date("2026-08-28T09:00:00.000Z")),
    ).toBe(false)
    // 区间外：早于 startAt
    expect(
      isTemporaryReleaseActive(payload, new Date("2026-08-26T07:00:00.000Z")),
    ).toBe(false)
  })

  it("supports overnight leave spanning across midnight", () => {
    const payload = {
      leaveStartAt: "2026-08-27T22:00:00+08:00",
      leaveEndAt: "2026-08-28T06:00:00+08:00",
    }
    // 22:30 +08:00 = 14:30 UTC，区间内
    expect(isLeaveActive(payload, new Date("2026-08-27T14:30:00.000Z"))).toBe(true)
    // 05:30 +08:00 次日 = 21:30 UTC 前一天，区间内
    expect(isLeaveActive(payload, new Date("2026-08-27T21:30:00.000Z"))).toBe(true)
    // 08:00 +08:00 次日 = 00:00 UTC 次日，区间外
    expect(isLeaveActive(payload, new Date("2026-08-28T00:00:00.000Z"))).toBe(false)
  })

  it("falls back to all-day range for legacy payloads with date strings", () => {
    const legacy = { leaveStartDate: "2026-08-26", leaveEndDate: "2026-08-28" }
    // 整天解读：8/26 全天 → 8/29 00:00 左闭右开
    expect(isLeaveActive(legacy, new Date("2026-08-26T16:00:00.000Z"))).toBe(true)
    // 8/28 当天 24:00 之前仍算
    expect(isLeaveActive(legacy, new Date("2026-08-28T15:00:00.000Z"))).toBe(true)
    // 8/29 起失效
    expect(isLeaveActive(legacy, new Date("2026-08-29T00:00:00.000Z"))).toBe(false)
  })

  it("returns false for payload with neither new nor legacy fields", () => {
    expect(isLeaveActive({}, new Date())).toBe(false)
    expect(isTemporaryReleaseActive({}, new Date())).toBe(false)
  })

  it("requires a valid leave datetime range", () => {
    expect(
      ApplicationDraftSchema.safeParse({
        type: "LEAVE",
        reason: "探望家属",
        leaveStartAt: "2026-08-30T10:00",
        leaveEndAt: "2026-08-30T09:00",
      }).success,
    ).toBe(false)
    expect(
      ApplicationDraftSchema.safeParse({
        type: "TEMPORARY_OUT_OF_CUSTODY",
        reason: "外出就医",
        temporaryReleaseStartAt: "2026-08-27T09:00",
        temporaryReleaseEndAt: "2026-08-27T18:00",
      }).success,
    ).toBe(true)
    expect(
      ApplicationDraftSchema.safeParse({
        type: "LEAVE",
        reason: "探望家属",
        leaveStartAt: "2026-08-29T09:00",
        leaveEndAt: "2026-08-30T18:00",
      }).success,
    ).toBe(true)
    // 缺字段必报
    expect(
      ApplicationDraftSchema.safeParse({
        type: "LEAVE",
        reason: "探望家属",
      }).success,
    ).toBe(false)
  })

  it("requires a locked archive reference for sentence reduction", () => {
    expect(
      ApplicationDraftSchema.safeParse({
        type: "SENTENCE_REDUCTION",
        reason: "表现良好",
      }).success,
    ).toBe(false)
    expect(
      ApplicationDraftSchema.safeParse({
        type: "SENTENCE_REDUCTION",
        reason: "表现良好",
        archiveRecordId,
      }).success,
    ).toBe(true)
  })

  it("accepts only supported review decisions", () => {
    expect(ApplicationReviewSchema.safeParse({ result: "APPROVED" }).success).toBe(true)
    expect(ApplicationReviewSchema.safeParse({ result: "PENDING" }).success).toBe(false)
  })
})
