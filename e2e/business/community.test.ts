import { randomUUID } from "node:crypto"
import { afterAll, beforeAll, expect, test, vi } from "vitest"
import { eq, inArray, sql } from "drizzle-orm"
import { NextRequest } from "next/server"
import { signToken } from "@/lib/auth"
import { db } from "@/lib/db"
import * as s from "@/lib/db/schema"
import {
  communityFeed,
  createCommunityPost,
  communityDetail,
  addCommunityComment,
  communityImage,
  deleteCommunityPost,
  deleteCommunityComment,
} from "@/lib/community-server"
import { POST as saveProfile } from "@/app/api/profile-records/route"
import { POST as submitProfile } from "@/app/api/profile-records/submit/route"

const auth = vi.hoisted(() => ({ token: "" }))
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
  headers: async () =>
    new Headers(auth.token ? { authorization: `Bearer ${auth.token}` } : {}),
}))
const users: string[] = []
const forms: string[] = []
let alice: string, bob: string, admin: string
const png =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jX1sAAAAASUVORK5CYII="

function request(body?: unknown) {
  return new NextRequest(
    "http://localhost/api/community/posts",
    body === undefined
      ? undefined
      : {
          method: "POST",
          body: JSON.stringify(body),
          headers: { "content-type": "application/json" },
        },
  )
}
async function account(role: "SUPERVISED" | "ADMIN") {
  const id = randomUUID()
  users.push(id)
  await db
    .insert(s.users)
    .values({
      id,
      role,
      username: `test_${id}`,
      name: `private_${id}`,
      passwordHash: "unused",
      mustChangePassword: false,
    })
  return id
}
async function as(id: string, role: "SUPERVISED" | "ADMIN" = "SUPERVISED") {
  auth.token = await signToken({ userId: id, role, tokenVersion: 0 })
}
beforeAll(async () => {
  expect(
    (await db.execute(sql`select current_database() as name`)).rows[0]?.name,
  ).toBe("custodysim_e2e")
  alice = await account("SUPERVISED")
  bob = await account("SUPERVISED")
  admin = await account("ADMIN")
})
afterAll(async () => {
  if (!users.length) return
  await db
    .delete(s.communityComments)
    .where(inArray(s.communityComments.authorId, users))
  await db
    .delete(s.communityPosts)
    .where(inArray(s.communityPosts.authorId, users))
  const records = await db
    .select({ id: s.profileRecords.id })
    .from(s.profileRecords)
    .where(inArray(s.profileRecords.userId, users))
  if (records.length)
    await db.delete(s.profileRecordReviews).where(
      inArray(
        s.profileRecordReviews.recordId,
        records.map((row) => row.id),
      ),
    )
  await db
    .delete(s.profileRecords)
    .where(inArray(s.profileRecords.userId, users))
  if (forms.length) {
    await db
      .delete(s.profileFields)
      .where(inArray(s.profileFields.formId, forms))
    await db.delete(s.profileForms).where(inArray(s.profileForms.id, forms))
  }
  await db.delete(s.auditLogs).where(inArray(s.auditLogs.actorId, users))
  await db.delete(s.users).where(inArray(s.users.id, users))
  await db.$client.end()
})

test("anonymous feed, stable participants, independent images and deletion permissions", async () => {
  auth.token = ""
  expect((await communityFeed(request())).status).toBe(401)
  expect(
    (await createCommunityPost(request({ title: "test", content: "test" })))
      .status,
  ).toBe(401)
  await as(alice)
  expect(
    (
      await createCommunityPost(
        request({ title: "bad", images: ["data:image/png;base64,YWJj"] }),
      )
    ).status,
  ).toBe(400)
  const created = await createCommunityPost(
    request({ title: "匿名交流", content: "公开正文", images: [png] }),
  )
  expect(created.status).toBe(201)
  const postId = (await created.json()).data.id as string
  await as(bob)
  for (const content of ["第一条", "第二条"])
    expect(
      (await addCommunityComment(request({ content }), postId)).status,
    ).toBe(201)
  const detailResponse = await communityDetail(request(), postId)
  expect(detailResponse.status).toBe(200)
  const detail = (await detailResponse.json()).data
  expect(detail.comments[0].authorLabel).toBe(detail.comments[1].authorLabel)
  expect(detail.comments[0].authorLabel).toMatch(/^匿名 [0-9A-F]{8}$/)
  expect(detail.comments[0].isOwn).toBe(true)
  expect(detail.post.isOwn).toBe(false)
  expect(detail.post.canDelete).toBe(false)
  for (const value of [
    alice,
    bob,
    `private_${alice}`,
    `test_${alice}`,
    "authorId",
    "userId",
    "base64",
  ]) {
    expect(JSON.stringify(detail)).not.toContain(value)
  }
  const feed = (await (await communityFeed(request())).json()).data
  const item = feed.posts.find((row: { id: string }) => row.id === postId)
  expect(item.imageUrls).toHaveLength(1)
  const imageId = item.imageUrls[0].split("/").at(-1)
  auth.token = ""
  expect((await communityImage(imageId)).status).toBe(401)
  await as(bob)
  const image = await communityImage(imageId)
  expect(image.headers.get("content-type")).toBe("image/png")
  expect((await image.arrayBuffer()).byteLength).toBeGreaterThan(12)
  expect((await deleteCommunityPost(postId)).status).toBe(404)
  expect((await deleteCommunityComment(detail.comments[0].id)).status).toBe(200)
  await as(alice)
  await addCommunityComment(request({ content: "楼主回复" }), postId)
  const ownReply = (
    await (await communityDetail(request(), postId)).json()
  ).data.comments.find((row: { isAuthor: boolean }) => row.isAuthor)
  expect(ownReply.authorLabel).toBe("楼主")
  await as(admin, "ADMIN")
  expect((await deleteCommunityPost(postId)).status).toBe(200)
  expect((await communityImage(imageId)).status).toBe(404)
  expect((await communityDetail(request(), postId)).status).toBe(404)
})

test("profile consent is persisted without publishing until submission, then publishes only selected fields", async () => {
  const formId = randomUUID()
  forms.push(formId)
  await db.insert(s.profileForms).values({ id: formId, name: "隐私测试档案" })
  await db.insert(s.profileFields).values([
    {
      formId,
      name: "姓名",
      type: "TEXT",
      required: false,
      options: [],
      sort: 0,
    },
    {
      formId,
      name: "技能",
      type: "TEXT",
      required: false,
      options: [],
      sort: 1,
    },
  ])
  await as(alice)
  const input = {
    formId,
    data: { 姓名: "真实姓名不公开", 技能: "绘画" },
    communityShare: true,
    communityShareFields: ["姓名"],
  }
  const identityConsent = await saveProfile(request(input))
  expect(identityConsent.status).toBe(201)
  const identityDraft = (await identityConsent.json()).data
  expect(identityDraft.communityShareFields).toEqual(["姓名"])
  expect(
    await db
      .select()
      .from(s.communityPosts)
      .where(eq(s.communityPosts.sourceRecordId, identityDraft.id)),
  ).toHaveLength(0)
  const saved = await saveProfile(
    request({ ...input, communityShareFields: ["技能"] }),
  )
  expect(saved.status).toBe(200)
  const recordId = (await saved.json()).data.id as string
  expect(recordId).toBe(identityDraft.id)
  expect(
    await db
      .select()
      .from(s.communityPosts)
      .where(eq(s.communityPosts.sourceRecordId, recordId)),
  ).toHaveLength(0)
  const submitted = await submitProfile(request({ recordId }))
  expect(submitted.status).toBe(200)
  const [post] = await db
    .select()
    .from(s.communityPosts)
    .where(eq(s.communityPosts.sourceRecordId, recordId))
  expect(post.profileSnapshot).toEqual([{ name: "技能", value: "绘画" }])
  expect((await submitProfile(request({ recordId }))).status).toBe(409)
  expect(
    await db
      .select()
      .from(s.communityPosts)
      .where(eq(s.communityPosts.sourceRecordId, recordId)),
  ).toHaveLength(1)
  await as(bob)
  const detail = (await (await communityDetail(request(), post.id)).json()).data
  expect(JSON.stringify(detail)).not.toContain(recordId)
  expect(JSON.stringify(detail)).not.toContain("真实姓名不公开")
  expect(JSON.stringify(detail)).not.toContain(`private_${alice}`)
  expect(JSON.stringify(detail)).not.toContain(`test_${alice}`)
  expect(JSON.stringify(detail)).not.toContain(alice)
  expect(detail.post.profileSnapshot).toEqual([{ name: "技能", value: "绘画" }])
})
