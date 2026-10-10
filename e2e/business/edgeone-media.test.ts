import { randomUUID } from "node:crypto"
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
async function book() {
  const id = randomUUID()
  books.push(id)
  await db.insert(s.libraryBooks).values({
    id,
    title: "media",
    filename: "media.txt",
    format: "TXT",
    bytes: Buffer.from("text"),
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
