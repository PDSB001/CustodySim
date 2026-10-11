import { createHash, randomUUID } from "node:crypto"
import { strToU8, zipSync } from "fflate"
import { afterAll, afterEach, beforeAll, expect, test, vi } from "vitest"
import { eq, inArray, sql } from "drizzle-orm"
import { db } from "@/lib/db"
import * as s from "@/lib/db/schema"
import { signToken } from "@/lib/auth"
import { AUTH_COOKIE_NAME } from "@/lib/constants"
import { MEDIA_PERMIT_HEADER } from "@/lib/edgeone-media"
import { GET as authorize } from "@/app/api/media/authorize/route"
import { GET as content } from "@/app/api/media/content/route"
import { GET as originalCover } from "@/app/api/library/[id]/cover/route"
import { GET as document } from "@/app/api/library/[id]/document/route"

const auth = vi.hoisted(() => ({ bearer: null as string | null, cookie: "" }))
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === AUTH_COOKIE_NAME ? { value: auth.cookie } : undefined,
  }),
  headers: async () =>
    new Headers(auth.bearer !== null ? { authorization: auth.bearer } : {}),
}))
const users: string[] = []
const books: string[] = []
const conversations: string[] = []
const posts: string[] = []
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jX1sAAAAASUVORK5CYII=",
  "base64",
)
const image = `data:image/png;base64,${png.toString("base64")}`
let alice: string, outsider: string, admin: string

async function account(role: "SUPERVISED" | "ADMIN") {
  const id = randomUUID()
  users.push(id)
  await db.insert(s.users).values({
    id,
    role,
    username: `media_${id}`,
    name: id,
    passwordHash: "unused",
    mustChangePassword: false,
  })
  return id
}
async function as(
  id: string,
  role: "SUPERVISED" | "ADMIN" = "SUPERVISED",
  cookie = false,
) {
  const token = await signToken({ userId: id, role, tokenVersion: 0 })
  auth.bearer = cookie ? null : `Bearer ${token}`
  auth.cookie = cookie ? token : ""
}
async function book(bytes = Buffer.from("text"), format = "TXT") {
  const id = randomUUID()
  books.push(id)
  await db.insert(s.libraryBooks).values({
    id,
    title: "media",
    filename: "media.txt",
    format,
    bytes,
    coverBytes: png,
    coverMime: "image/png",
    coverUpdatedAt: new Date(1_800_000_000_000),
  })
  return id
}
async function chat(ageDays = 0) {
  const id = randomUUID(),
    messageId = randomUUID()
  conversations.push(id)
  await db
    .insert(s.chatConversations)
    .values({ id, type: "DIRECT", createdBy: alice })
  await db
    .insert(s.chatConversationMembers)
    .values({ conversationId: id, userId: alice })
  await db.insert(s.chatMessages).values({
    id: messageId,
    conversationId: id,
    senderId: alice,
    type: "IMAGE",
    content: image,
    createdAt: new Date(Date.now() - ageDays * 86_400_000),
  })
  return { id, messageId, path: `/api/chat/messages/${messageId}/image` }
}
function request(target: string) {
  const url = new URL("http://localhost/api/media/authorize")
  url.searchParams.set("target", target)
  return new Request(url)
}
function bytes(permit: string) {
  return content(
    new Request("http://localhost/api/media/content", {
      headers: { [MEDIA_PERMIT_HEADER]: permit },
    }),
  )
}

beforeAll(async () => {
  expect(
    (await db.execute(sql`select current_database() as name`)).rows[0]?.name,
  ).toBe("custodysim_e2e")
  alice = await account("SUPERVISED")
  outsider = await account("SUPERVISED")
  admin = await account("ADMIN")
})

test("stored book revisions preserve existing reader identities; metadata reads no blobs and replacements revoke permits", async () => {
  enable()
  await as(alice)
  const id = await book()
  const path = `/api/library/${id}/file`
  const revision = (value: string) =>
    createHash("sha256")
      .update("reader-schema-3:")
      .update(value)
      .digest("hex")
      .slice(0, 24)
  const grant = await (await authorize(request(path))).json()
  expect(grant.revision).toBe(revision("text"))
  expect(await (await bytes(grant.permit)).text()).toBe("text")
  const select = vi.spyOn(db, "select")
  try {
    const metadata = await document(
      new Request("http://localhost/document?metadata=1"),
      { params: Promise.resolve({ id }) },
    )
    expect((await metadata.json()).data.revision).toBe(grant.revision)
    expect(
      select.mock.calls.every(
        ([fields]) =>
          !fields || !Object.values(fields).includes(s.libraryBooks.bytes),
      ),
    ).toBe(true)
  } finally {
    select.mockRestore()
  }
  await db
    .update(s.libraryBooks)
    .set({ bytes: Buffer.from("replacement") })
    .where(eq(s.libraryBooks.id, id))
  expect((await bytes(grant.permit)).status).toBe(404)
  const replaced = await (await authorize(request(path))).json()
  expect(replaced.revision).toBe(revision("replacement"))
  expect(await (await bytes(replaced.permit)).text()).toBe("replacement")
  await db
    .update(s.libraryBooks)
    .set({ enabled: false })
    .where(eq(s.libraryBooks.id, id))
  expect((await authorize(request(path))).status).toBe(404)
  expect((await bytes(replaced.permit)).status).toBe(404)
  await as(admin, "ADMIN")
  expect((await authorize(request(path))).status).toBe(200)
  await db
    .update(s.libraryBooks)
    .set({ deletedAt: new Date() })
    .where(eq(s.libraryBooks.id, id))
  expect((await authorize(request(path))).status).toBe(404)
})

test("EPUB image permits bind one archive resource, canonicalize queries and exclude personal metadata", async () => {
  enable()
  await as(alice)
  const archive = Buffer.from(
    zipSync({
      mimetype: strToU8("application/epub+zip"),
      "META-INF/container.xml": strToU8(
        '<container><rootfiles><rootfile full-path="OPS/book.opf"/></rootfiles></container>',
      ),
      "OPS/book.opf": strToU8(
        '<package><manifest><item id="a" href="a.png" media-type="image/png"/><item id="b" href="b.png" media-type="image/png"/></manifest><spine/></package>',
      ),
      "OPS/a.png": png,
      "OPS/b.png": Buffer.concat([png, Buffer.from("b")]),
    }),
  )
  const id = await book(archive, "EPUB")
  const first = `/api/library/${id}/resource?path=OPS%2Fa.png`
  const second = `/api/library/${id}/resource?path=OPS%2Fb.png`
  const a = await (await authorize(request(first))).json()
  const b = await (await authorize(request(second))).json()
  expect(a.resourceKey).not.toBe(b.resourceKey)
  expect(a.revision).toBe(b.revision)
  expect(a.target).toBe(first)
  expect(Buffer.from(await (await bytes(a.permit)).arrayBuffer())).toEqual(png)
  expect(Buffer.from(await (await bytes(b.permit)).arrayBuffer())).toEqual(
    Buffer.concat([png, Buffer.from("b")]),
  )
  for (const target of [
    `/api/library/${id}/document?metadata=1`,
    `${first}&path=OPS%2Fb.png`,
    `/api/library/${id}/resource?path=..%2Fa.png`,
  ])
    expect((await authorize(request(target))).status).toBe(404)
  const missing = await (
    await authorize(
      request(`/api/library/${id}/resource?path=OPS%2Fmissing.png`),
    )
  ).json()
  expect((await bytes(missing.permit)).status).toBe(404)
})

test("document snapshots share content without identities; warm parsing reads no bytes and still enforces access", async () => {
  enable()
  const id = await book(Buffer.from("共享正文测试"))
  const target = `/api/library/${id}/document`
  const context = { params: Promise.resolve({ id }) }
  await as(alice)
  const firstGrant = await (await authorize(request(target))).json()
  expect(firstGrant.readerSchema).toBe("reader-schema-3-v1")
  const firstCommon = await (await bytes(firstGrant.permit)).json()
  expect(firstCommon.data.readerKey).toBeUndefined()
  expect(firstCommon.data.text).toContain("共享正文测试")
  expect(
    (await (await document(request(target), context)).json()).data.readerKey,
  ).toBe(firstGrant.readerKey)
  await as(outsider)
  const select = vi.spyOn(db, "select")
  try {
    const secondGrant = await (await authorize(request(target))).json()
    expect(secondGrant.readerKey).not.toBe(firstGrant.readerKey)
    expect((await bytes(firstGrant.permit)).status).toBe(403)
    expect(await (await bytes(secondGrant.permit)).json()).toEqual(firstCommon)
    const direct = await (await document(request(target), context)).json()
    expect(direct.data.readerKey).toBe(secondGrant.readerKey)
    expect(
      select.mock.calls.every(
        ([fields]) =>
          !fields || !Object.values(fields).includes(s.libraryBooks.bytes),
      ),
    ).toBe(true)
    await db
      .update(s.libraryBooks)
      .set({ enabled: false })
      .where(eq(s.libraryBooks.id, id))
    expect((await document(request(target), context)).status).toBe(404)
    expect((await bytes(secondGrant.permit)).status).toBe(404)
  } finally {
    select.mockRestore()
  }
  await as(admin, "ADMIN")
  expect((await document(request(target), context)).status).toBe(200)
  await db
    .update(s.libraryBooks)
    .set({ bytes: Buffer.from("更新后的正文") })
    .where(eq(s.libraryBooks.id, id))
  const replacement = await (await document(request(target), context)).json()
  expect(replacement.data.text).toContain("更新后的正文")
  expect(replacement.data.revision).not.toBe(firstGrant.revision)
})
afterEach(() => {
  vi.unstubAllEnvs()
  auth.bearer = null
  auth.cookie = ""
})
function enable() {
  vi.stubEnv("EDGEONE_MEDIA_CACHE_ENABLED", "true")
  vi.stubEnv("EDGEONE_MEDIA_SIGNING_KEY", "3a98bc57d62f104e".repeat(4))
}
afterAll(async () => {
  if (conversations.length)
    await db
      .delete(s.chatConversations)
      .where(inArray(s.chatConversations.id, conversations))
  if (posts.length)
    await db.delete(s.communityPosts).where(inArray(s.communityPosts.id, posts))
  if (books.length)
    await db.delete(s.libraryBooks).where(inArray(s.libraryBooks.id, books))
  if (users.length) await db.delete(s.users).where(inArray(s.users.id, users))
  await db.$client.end()
})

test("disabled is a safe bypass; old cover interface still works without new configuration", async () => {
  vi.stubEnv("EDGEONE_MEDIA_CACHE_ENABLED", "false")
  const id = await book()
  expect((await authorize(request(`/api/library/${id}/cover`))).status).toBe(
    204,
  )
  await as(alice)
  const response = await originalCover(new Request("http://localhost"), {
    params: Promise.resolve({ id }),
  })
  expect(Buffer.from(await response.arrayBuffer())).toEqual(png)
})

test("cookie/native login authorizes a small grant; permit alone, another user and tampering cannot retrieve bytes", async () => {
  enable()
  const message = await chat()
  expect((await authorize(request(message.path))).status).toBe(401)
  await as(alice, "SUPERVISED", true)
  const grantResponse = await authorize(request(message.path))
  const grant = await grantResponse.json()
  expect(grantResponse.headers.get("cache-control")).toBe("private, no-store")
  expect(grant.cacheable).toBe(true)
  expect(JSON.stringify(grant)).not.toContain(png.toString("base64"))
  const response = await bytes(grant.permit)
  expect(response.status).toBe(200)
  expect(response.headers.get("cache-control")).toBe("private, no-store")
  expect(Buffer.from(await response.arrayBuffer())).toEqual(png)
  auth.cookie = ""
  expect((await bytes(grant.permit)).status).toBe(403)
  await as(outsider)
  expect((await authorize(request(message.path))).status).toBe(404)
  expect((await bytes(grant.permit)).status).toBe(403)
  await as(alice)
  expect((await bytes(`x${grant.permit}`)).status).toBe(403)
  expect((await bytes(grant.permit)).status).toBe(200)
})

test("recall and membership removal deny new grants and previously issued permits immediately", async () => {
  enable()
  await as(alice)
  const message = await chat()
  const grant = await (await authorize(request(message.path))).json()
  await db
    .update(s.chatMessages)
    .set({ recalledAt: new Date() })
    .where(eq(s.chatMessages.id, message.messageId))
  expect((await authorize(request(message.path))).status).toBe(404)
  expect((await bytes(grant.permit)).status).toBe(404)
  const other = await chat()
  const otherGrant = await (await authorize(request(other.path))).json()
  await db
    .update(s.chatConversationMembers)
    .set({ leftAt: new Date() })
    .where(eq(s.chatConversationMembers.conversationId, other.id))
  expect((await authorize(request(other.path))).status).toBe(404)
  expect((await bytes(otherGrant.permit)).status).toBe(404)
})

test("role-specific retention and account revocation remain enforced", async () => {
  enable()
  await as(alice)
  const old = await chat(20)
  expect((await authorize(request(old.path))).status).toBe(404)
  await as(admin, "ADMIN")
  expect((await authorize(request(old.path))).status).toBe(200)
  await as(outsider)
  const id = await book()
  const path = `/api/library/${id}/cover?v=0`
  const grant = await (await authorize(request(path))).json()
  await db
    .update(s.users)
    .set({ tokenVersion: 1 })
    .where(eq(s.users.id, outsider))
  expect((await authorize(request(path))).status).toBe(401)
  expect((await bytes(grant.permit)).status).toBe(403)
})

test("cover revision comes from the database; replacing, removing and disabling covers invalidate grants", async () => {
  enable()
  await as(alice)
  const id = await book(),
    path = `/api/library/${id}/cover?v=123`
  const grant = await (await authorize(request(path))).json()
  expect(grant.revision).toBe("1800000000000")
  await db
    .update(s.libraryBooks)
    .set({ coverUpdatedAt: new Date(1_800_000_000_001) })
    .where(eq(s.libraryBooks.id, id))
  expect((await bytes(grant.permit)).status).toBe(404)
  expect((await (await authorize(request(path))).json()).revision).toBe(
    "1800000000001",
  )
  await db
    .update(s.libraryBooks)
    .set({ enabled: false })
    .where(eq(s.libraryBooks.id, id))
  expect((await authorize(request(path))).status).toBe(404)
  await as(admin, "ADMIN")
  expect((await authorize(request(path))).status).toBe(200)
  await db
    .update(s.libraryBooks)
    .set({ coverBytes: null })
    .where(eq(s.libraryBooks.id, id))
  expect((await authorize(request(path))).status).toBe(404)
})

test("deleting community images invalidates grants without sending image data during auth", async () => {
  enable()
  await as(alice)
  const postId = randomUUID(),
    imageId = randomUUID()
  posts.push(postId)
  await db
    .insert(s.communityPosts)
    .values({ id: postId, authorId: alice, title: "media", content: "test" })
  await db
    .insert(s.communityImages)
    .values({ id: imageId, postId, data: image, position: 0 })
  const path = `/api/community/images/${imageId}`
  const grant = await (await authorize(request(path))).json()
  expect(Buffer.from(await (await bytes(grant.permit)).arrayBuffer())).toEqual(
    png,
  )
  await db.delete(s.communityPosts).where(eq(s.communityPosts.id, postId))
  expect((await authorize(request(path))).status).toBe(404)
  expect((await bytes(grant.permit)).status).toBe(404)
})
