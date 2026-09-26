import { randomUUID } from "node:crypto"
import { afterAll, beforeAll, expect, test, vi } from "vitest"
import { eq, inArray, sql } from "drizzle-orm"
import { NextRequest } from "next/server"
import { db } from "@/lib/db"
import { persons, users, profileForms, profileRecords } from "@/lib/db/schema"
import { GET } from "@/app/api/admin/persons/route"

const auth = vi.hoisted(() => ({ allowed: true }))
vi.mock("@/lib/admin-api", () => ({
  getAdminUser: async () =>
    auth.allowed ? { id: "test-admin", role: "ADMIN" } : null,
}))
const prefix = `plist-${randomUUID().slice(0, 8)}`
const userId = randomUUID()
const personIds = Array.from({ length: 28 }, () => randomUUID())
const formIds = [randomUUID(), randomUUID()]
let seeded = false

async function list(query = "") {
  return GET(
    new NextRequest(
      `http://localhost/api/admin/persons${query ? `?${query}` : ""}`,
    ),
  )
}

beforeAll(async () => {
  expect(
    (await db.execute(sql`select current_database() as name`)).rows[0]?.name,
  ).toBe("custodysim_e2e")
  await db.transaction(async (tx) => {
    await tx.insert(users).values({
      id: userId,
      username: `${prefix}-account`,
      name: prefix,
      passwordHash: "test-only",
      role: "SUPERVISED",
    })
    await tx.insert(persons).values(
      personIds.map((id, index) => ({
        id,
        name: `${prefix}-${index === 0 ? "literal%_" : index === 1 ? "literalXY" : String(index).padStart(2, "0")}`,
        userId: index === 0 ? userId : null,
        customNumber: `${prefix}-number-${index}`,
        createdAt: new Date("2026-01-01T00:00:00Z"),
      })),
    )
    await tx
      .insert(profileForms)
      .values(formIds.map((id) => ({ id, name: prefix })))
    await tx.insert(profileRecords).values(
      formIds.map((formId, index) => ({
        userId,
        formId,
        status: index ? "PENDING_REVIEW" : "LOCKED",
      })),
    )
  })
  seeded = true
})

afterAll(async () => {
  if (seeded) {
    await db.delete(profileRecords).where(eq(profileRecords.userId, userId))
    await db.delete(profileForms).where(inArray(profileForms.id, formIds))
    await db.delete(persons).where(inArray(persons.id, personIds))
    await db.delete(users).where(eq(users.id, userId))
  }
  await db.$client.end()
})

test("stable pages have no overlaps, include archive totals, and clamp past the last page", async () => {
  const first = await (await list(`q=${prefix}&page=1&pageSize=25`)).json()
  const last = await (await list(`q=${prefix}&page=99&pageSize=25`)).json()
  expect(first.success).toBe(true)
  expect(first.data.total).toBe(28)
  expect(first.data.items).toHaveLength(25)
  expect(last.data.page).toBe(2)
  expect(last.data.items).toHaveLength(3)
  const all = [...first.data.items, ...last.data.items]
  expect(new Set(all.map((item) => item.id)).size).toBe(28)
  expect(all.find((item) => item.userId === userId)).toMatchObject({
    archiveRecordCount: 2,
    archiveStatus: "PENDING_REVIEW",
  })
  expect(all.find((item) => item.userId === null)).toMatchObject({
    archiveRecordCount: 0,
    archiveStatus: "UNFILLED",
  })
})

test("search matches literal wildcards, custom number, and account", async () => {
  for (const q of [
    `${prefix}-literal%_`,
    `${prefix}-account`,
    `${prefix}-number-27`,
  ]) {
    const response = await (
      await list(new URLSearchParams({ q }).toString())
    ).json()
    expect(response.data.total).toBe(1)
    expect(response.data.items).toHaveLength(1)
  }
  const empty = await (await list(`q=${prefix}-absent&page=9`)).json()
  expect(empty.data).toMatchObject({ items: [], total: 0, page: 1 })
})

test("legacy calls return arrays and bad pagination is rejected", async () => {
  const legacy = await (await list()).json()
  expect(Array.isArray(legacy.data)).toBe(true)
  expect(
    legacy.data.filter((item: { name: string }) =>
      item.name.startsWith(prefix),
    ),
  ).toHaveLength(28)
  expect((await list("page=0")).status).toBe(400)
  expect((await list("pageSize=101")).status).toBe(400)
  auth.allowed = false
  try {
    expect((await list("page=1")).status).toBe(403)
  } finally {
    auth.allowed = true
  }
})
