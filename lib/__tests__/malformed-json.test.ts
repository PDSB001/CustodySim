import { expect, test, vi } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/lib/session", () => ({
  getSessionUser: async () => ({
    id: "00000000-0000-4000-8000-000000000001",
    role: "SUPERVISED",
  }),
}))
vi.mock("@/lib/admin-api", () => ({
  getAdminUser: async () => ({
    id: "00000000-0000-4000-8000-000000000002",
    role: "ADMIN",
  }),
  getRequestIp: () => null,
}))

import { POST as checkin } from "@/app/api/checkins/route"
import { POST as batch } from "@/app/api/mobile/location/batch/route"
import { POST as sort } from "@/app/api/admin/orgs/sort/route"
import { PATCH as form } from "@/app/api/admin/profile-forms/[id]/route"

test.each([
  checkin,
  batch,
  sort,
  (request: NextRequest) =>
    form(request, {
      params: Promise.resolve({ id: "00000000-0000-4000-8000-000000000003" }),
    }),
])("truncated JSON produces the normal 400 envelope", async (route) => {
  const response = await route(
    new NextRequest("http://localhost/api/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: '{"incomplete":',
    }),
  )
  expect(response.status).toBe(400)
  expect(await response.json()).toMatchObject({
    success: false,
    error: { code: "VALIDATION_ERROR" },
  })
})
