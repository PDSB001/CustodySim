import { describe, expect, it } from "vitest"
import {
  escapeLikeSearch,
  PersonListQuerySchema,
  summarizePersonArchives,
} from "../person-list"

describe("person list", () => {
  it("uses bounded pagination defaults and trims search", () => {
    expect(PersonListQuerySchema.parse({})).toEqual({
      page: 1,
      pageSize: 25,
      q: "",
    })
    expect(
      PersonListQuerySchema.parse({ page: "2", pageSize: "100", q: " 张三 " }),
    ).toEqual({ page: 2, pageSize: 100, q: "张三" })
  })
  it.each(["0", "-1", "1.5", "1e3", "", "Infinity", "1000001"])(
    "rejects invalid page %s",
    (page) => {
      expect(PersonListQuerySchema.safeParse({ page }).success).toBe(false)
    },
  )
  it("rejects oversized pages and searches", () => {
    expect(PersonListQuerySchema.safeParse({ pageSize: "101" }).success).toBe(
      false,
    )
    expect(
      PersonListQuerySchema.safeParse({ q: "字".repeat(101) }).success,
    ).toBe(false)
  })
  it("searches wildcard characters literally", () => {
    expect(escapeLikeSearch("a%b_c\\d")).toBe("a\\%b\\_c\\\\d")
  })
  it("preserves archive status precedence and counts independently of order", () => {
    const rows = [
      { userId: "a", status: "LOCKED", count: 3 },
      { userId: "a", status: "RETURNED", count: 2 },
      { userId: "a", status: "PENDING_REVIEW", count: 1 },
      { userId: "b", status: "LOCKED", count: 4 },
      { userId: "c", status: "LOCKED", count: 1 },
      { userId: "c", status: "DRAFT", count: 2 },
      { userId: "d", status: "RETURNED", count: 1 },
    ]
    const result = summarizePersonArchives(rows)
    expect(result).toEqual(summarizePersonArchives([...rows].reverse()))
    expect(result.get("a")).toEqual({
      archiveRecordCount: 6,
      archiveStatus: "PENDING_REVIEW",
    })
    expect(result.get("b")?.archiveStatus).toBe("LOCKED")
    expect(result.get("c")?.archiveStatus).toBe("DRAFT")
    expect(result.get("d")?.archiveStatus).toBe("RETURNED")
    expect(result.has("unlinked")).toBe(false)
  })
})
