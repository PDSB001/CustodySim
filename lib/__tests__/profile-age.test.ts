import { describe, expect, it } from "vitest"

import {
  applyComputedProfileAge,
  calculateAgeFromBirthMonth,
} from "@/lib/profile-age"

const profileFields = [
  { name: "姓名" },
  { name: "年龄" },
  { name: "出生年月" },
]

describe("profile age", () => {
  it("calculates age from the birth year and month", () => {
    const today = new Date(2026, 7, 27)
    expect(calculateAgeFromBirthMonth("2000-08", today)).toBe(26)
    expect(calculateAgeFromBirthMonth("2000-09", today)).toBe(25)
  })

  it("replaces a manually supplied age when birth month is available", () => {
    expect(
      applyComputedProfileAge(
        { 姓名: "示范被监管人", 出生年月: "2000-09", 年龄: 99 },
        profileFields,
        new Date(2026, 7, 27),
      ),
    ).toEqual({ 姓名: "示范被监管人", 出生年月: "2000-09", 年龄: 25 })
  })

  it("does not keep a manually supplied age when birth month is invalid", () => {
    expect(
      applyComputedProfileAge(
        { 出生年月: "2000-13", 年龄: 99 },
        profileFields,
        new Date(2026, 7, 27),
      ),
    ).toEqual({ 出生年月: "2000-13" })
  })
})
