import { beforeEach, expect, test, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  select: vi.fn(),
  document: vi.fn(),
}))
vi.mock("@/lib/session", () => ({ getSessionUser: mocks.session }))
vi.mock("@/lib/db", () => ({ db: { select: mocks.select } }))
vi.mock("@/lib/reader-document-cache", () => ({
  cachedReaderDocument: mocks.document,
  ReaderSourceChangedError: class extends Error {},
}))
import { GET } from "@/app/api/library/[id]/document-origin/route"

const bookId = "fe653277-ef77-454d-9174-2e37513a66d6"
const request = () =>
  new Request(`https://site.test/api/library/${bookId}/document-origin`, {
    headers: { "X-CustodySim-Reader-Delivery": "shared-v1" },
  })
const context = () => ({ params: Promise.resolve({ id: bookId }) })

beforeEach(() => {
  vi.resetAllMocks()
  mocks.session.mockResolvedValue({ id: "current-user", role: "SUPERVISED" })
})

function books(rows: unknown[]) {
  mocks.select.mockReturnValue({ from: () => ({ where: async () => rows }) })
}

test("recovery rejects an expired session before querying books", async () => {
  mocks.session.mockResolvedValue(null)
  expect((await GET(request(), context())).status).toBe(401)
  expect(mocks.select).not.toHaveBeenCalled()
  expect(mocks.document).not.toHaveBeenCalled()
})

test.each([
  { name: "missing", rows: [] },
  { name: "disabled", rows: [{ enabled: false }] },
  { name: "deleted", rows: [{ enabled: true, deletedAt: new Date() }] },
])(
  "recovery rejects $name books without reading document bytes",
  async ({ rows }) => {
    books(rows)
    expect((await GET(request(), context())).status).toBe(404)
    expect(mocks.document).not.toHaveBeenCalled()
  },
)

test("recovery returns personal identity with no-store even with a shared delivery header", async () => {
  books([
    {
      enabled: true,
      deletedAt: null,
      revision: "0123456789abcdef01234567",
      format: "EPUB",
    },
  ])
  mocks.document.mockResolvedValue({
    version: 1,
    format: "EPUB",
    chapters: [{ html: "正文" }],
  })
  const response = await GET(request(), context())
  expect(response.status).toBe(200)
  expect(response.headers.get("Cache-Control")).toBe("private, no-store")
  const body = await response.json()
  expect(body.data.readerKey).toMatch(/^[0-9a-f]{24}$/)
  expect(body.data.chapters).toEqual([{ html: "正文" }])
  expect(response.headers.has("X-CustodySim-Reader-Delivery")).toBe(false)
})
