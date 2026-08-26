import { describe, expect, it } from "vitest"

import {
  buildCategoryOrgTree,
  buildEffectiveCategoryMap,
} from "@/lib/org-category"

const organizations = [
  { id: "root", name: "根组织", parentId: null, category: "监管", sort: 0 },
  {
    id: "inherited",
    name: "继承组织",
    parentId: "root",
    category: null,
    sort: 0,
  },
  {
    id: "override",
    name: "覆盖组织",
    parentId: "root",
    category: "行政",
    sort: 1,
  },
  {
    id: "leaf",
    name: "叶子组织",
    parentId: "inherited",
    category: null,
    sort: 0,
  },
]

describe("organization categories", () => {
  it("uses the organization category", () => {
    expect(buildEffectiveCategoryMap(organizations).get("root")).toBe("监管")
  })
  it("inherits a parent category", () => {
    expect(buildEffectiveCategoryMap(organizations).get("inherited")).toBe(
      "监管",
    )
  })
  it("uses an explicit override", () => {
    expect(buildEffectiveCategoryMap(organizations).get("override")).toBe(
      "行政",
    )
  })
  it("inherits through multiple levels", () => {
    expect(buildEffectiveCategoryMap(organizations).get("leaf")).toBe("监管")
  })
  it("filters organization tree by effective category", () => {
    expect(
      buildCategoryOrgTree(organizations, "行政").map((item) => item.id),
    ).toEqual(["override"])
  })
})
