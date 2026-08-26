import { describe, expect, it } from "vitest"

import {
  getAllowedChildCategories,
  validateOrganizationPlacement,
} from "@/lib/org-hierarchy"

const organizations = [
  { id: "root", name: "机构", parentId: null, category: "ROOT", sort: 0 },
  {
    id: "supervision",
    name: "监管组织",
    parentId: "root",
    category: "SUPERVISION_ROOT",
    sort: 0,
  },
  {
    id: "collection",
    name: "人员集合",
    parentId: "root",
    category: "SUPERVISED_ROOT",
    sort: 1,
  },
  {
    id: "ward",
    name: "一监区",
    parentId: "collection",
    category: "WARD",
    sort: 0,
  },
] as const

describe("organization hierarchy", () => {
  it("allows the two branches below root", () => {
    expect(getAllowedChildCategories("ROOT")).toEqual([
      "SUPERVISION_ROOT",
      "SUPERVISED_ROOT",
    ])
  })
  it("allows wards below supervised collection", () => {
    expect(getAllowedChildCategories("SUPERVISED_ROOT")).toEqual(["WARD"])
  })
  it("allows rooms below a ward", () => {
    expect(getAllowedChildCategories("WARD")).toEqual(["ROOM"])
  })
  it("rejects a room directly below collection", () => {
    expect(
      validateOrganizationPlacement({
        organizations: [...organizations],
        parentId: "collection",
        category: "ROOM",
      }),
    ).toContain("不能创建")
  })
  it("allows a room below ward", () => {
    expect(
      validateOrganizationPlacement({
        organizations: [...organizations],
        parentId: "ward",
        category: "ROOM",
      }),
    ).toBeNull()
  })
  it("rejects another root", () => {
    expect(
      validateOrganizationPlacement({
        organizations: [...organizations],
        parentId: null,
        category: "ROOT",
      }),
    ).toContain("只能存在一个")
  })
})
