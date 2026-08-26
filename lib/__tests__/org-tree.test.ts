import { describe, expect, it } from "vitest"

import { buildOrgPathMap, buildOrgTree } from "@/lib/org-tree"

const organizations = [
  { id: "root", name: "总机构", parentId: null, sort: 1 },
  { id: "child-a", name: "第一单位", parentId: "root", sort: 2 },
  { id: "child-b", name: "第二单位", parentId: "root", sort: 1 },
  { id: "leaf", name: "执行组", parentId: "child-a", sort: 1 },
]

describe("organization tree", () => {
  it("builds a nested tree", () => {
    const tree = buildOrgTree(organizations)
    expect(tree).toHaveLength(1)
    expect(tree[0]?.children.map((item) => item.id)).toEqual([
      "child-b",
      "child-a",
    ])
  })
  it("sorts nested children", () => {
    expect(buildOrgTree(organizations)[0]?.children[1]?.children[0]?.id).toBe(
      "leaf",
    )
  })
  it("builds full paths", () => {
    expect(buildOrgPathMap(organizations).get("leaf")).toBe(
      "总机构 / 第一单位 / 执行组",
    )
  })
  it("keeps an orphan at root", () => {
    expect(
      buildOrgTree([
        { id: "orphan", name: "孤立组织", parentId: "none", sort: 0 },
      ]),
    ).toHaveLength(1)
  })
  it("does not recurse self reference", () => {
    expect(
      buildOrgTree([{ id: "self", name: "自身", parentId: "self", sort: 0 }])[0]
        ?.name,
    ).toBe("自身")
  })
})
