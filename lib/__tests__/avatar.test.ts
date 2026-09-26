import { describe, expect, it, vi, beforeEach } from "vitest"
import { validAvatar } from "@/lib/avatar"

// Minimal JPEG frame header fixture: tests bounds/type parsing, not image decoding.
function frame(width = 192, height = 192) {
  return (
    "data:image/jpeg;base64," +
    Buffer.from([
      0xff,
      0xd8,
      0xff,
      0xc0,
      0,
      11,
      8,
      height >> 8,
      height & 255,
      width >> 8,
      width & 255,
      1,
      1,
      0x11,
      0,
      0xff,
      0xd9,
    ]).toString("base64")
  )
}

describe("avatar bounds", () => {
  it("accepts bounded JPEG frame dimensions", () =>
    expect(validAvatar(frame())).toBe(true))
  it("rejects oversized decoded dimensions", () =>
    expect(validAvatar(frame(513, 192))).toBe(false))
  it("rejects zero-sized images", () =>
    expect(validAvatar(frame(0, 192))).toBe(false))
  it("rejects URLs, SVG and forged MIME headers", () => {
    for (const value of [
      "https://example.com/a.jpg",
      "data:image/svg+xml;base64,PHN2Zz4=",
      "data:image/jpeg;base64,aGVsbG8=",
      null,
    ])
      expect(validAvatar(value)).toBe(false)
  })
  it("rejects excessive input before decoding", () =>
    expect(validAvatar("data:image/jpeg;base64," + "A".repeat(100_000))).toBe(
      false,
    ))
})

const mocks = vi.hoisted(() => ({
  actor: vi.fn(),
  set: vi.fn(),
  where: vi.fn(),
  returning: vi.fn(),
  eq: vi.fn(),
}))
vi.mock("@/lib/session", () => ({ getSessionUser: mocks.actor }))
vi.mock("@/lib/db", () => ({ db: { update: () => ({ set: mocks.set }) } }))
vi.mock("drizzle-orm", async (original) => ({
  ...(await original<typeof import("drizzle-orm")>()),
  eq: mocks.eq,
}))
import { PATCH } from "@/app/api/me/avatar/route"

describe("avatar mutation", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.actor.mockResolvedValue({ id: "self" })
    mocks.set.mockReturnValue({ where: mocks.where })
    mocks.where.mockReturnValue({ returning: mocks.returning })
    mocks.returning.mockResolvedValue([{ avatar: null }])
  })
  const request = (body: unknown) =>
    new Request("http://localhost/api/me/avatar", {
      method: "PATCH",
      body: JSON.stringify(body),
    })
  it("requires authentication", async () => {
    mocks.actor.mockResolvedValue(null)
    expect((await PATCH(request({ avatar: null }))).status).toBe(401)
    expect(mocks.set).not.toHaveBeenCalled()
  })
  it("updates only the session owner even if a target id is supplied", async () => {
    expect(
      (await PATCH(request({ avatar: frame(), userId: "someone-else" })))
        .status,
    ).toBe(200)
    expect(mocks.eq).toHaveBeenCalledWith(expect.anything(), "self")
    expect(mocks.set).toHaveBeenCalledWith(
      expect.objectContaining({ avatar: frame() }),
    )
  })
  it("allows restoring the default avatar", async () => {
    const result = await PATCH(request({ avatar: null }))
    expect((await result.json()).data.avatar).toBeNull()
  })
  it("rejects oversized request bodies without writing", async () => {
    expect((await PATCH(request({ avatar: "a".repeat(100_000) }))).status).toBe(
      413,
    )
    expect(mocks.set).not.toHaveBeenCalled()
  })
  it("rejects missing or invalid avatars", async () => {
    expect((await PATCH(request({}))).status).toBe(400)
    expect((await PATCH(request({ avatar: "file:///private" }))).status).toBe(
      400,
    )
    expect(mocks.set).not.toHaveBeenCalled()
  })
})
