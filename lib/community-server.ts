import { and, asc, desc, eq, inArray, sql } from "drizzle-orm"
import { z } from "zod"
import { db } from "@/lib/db"
import {
  communityPosts,
  communityImages,
  communityComments,
} from "@/lib/db/schema"
import { failure, success } from "@/lib/api-response"
import { getSessionUser, type SessionUser } from "@/lib/session"
import { communityAuthorLabel } from "@/lib/community-privacy"
import { assertUsableSecret } from "@/lib/secret-guard"
import {
  parseTaskImageDataUrl,
  validateTaskImageDataUrl,
} from "@/lib/task-image"

const Id = z.string().uuid()
const PostInput = z
  .object({
    title: z.string().trim().min(1).max(120),
    content: z.string().trim().max(5000).default(""),
    images: z.array(z.string().max(1_400_000)).max(3).default([]),
  })
  .refine(
    (post) => post.content.length > 0 || post.images.length > 0,
    "请填写正文或上传图片",
  )
const CommentInput = z.object({ content: z.string().trim().min(1).max(2000) })

// A body limit applies even when Content-Length is absent.
async function readBody(request: Request, max: number): Promise<unknown> {
  if (!request.body) throw new Error("请求为空")
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const result = await reader.read()
      if (result.done) break
      size += result.value.length
      if (size > max) {
        await reader.cancel()
        throw new Error("内容过大")
      }
      chunks.push(result.value)
    }
  } finally {
    reader.releaseLock()
  }
  const bytes = Buffer.concat(chunks)
  return JSON.parse(bytes.toString("utf8"))
}
function pageOf(request: Request) {
  const page = Number(new URL(request.url).searchParams.get("page") ?? "0")
  return Number.isSafeInteger(page) && page >= 0 && page <= 10000 ? page : null
}
function label(postId: string, authorId: string, postAuthorId: string) {
  return communityAuthorLabel(
    postId,
    authorId,
    postAuthorId,
    assertUsableSecret("AUTH_SECRET", process.env.AUTH_SECRET),
  )
}
const columns = {
  id: communityPosts.id,
  authorId: communityPosts.authorId,
  title: communityPosts.title,
  content: communityPosts.content,
  createdAt: communityPosts.createdAt,
  profileSnapshot: communityPosts.profileSnapshot,
  // 显式限定外层表，避免子查询把 id 解析成评论自己的 id。
  commentCount: sql<number>`(SELECT count(*)::int FROM community_comments WHERE post_id = "community_posts"."id")`,
}
async function serializePosts(
  rows:
    | (typeof communityPosts.$inferSelect & { commentCount: number })[]
    | {
        id: string
        authorId: string
        title: string
        content: string
        createdAt: Date
        profileSnapshot: { name: string; value: string }[] | null
        commentCount: number
      }[],
  actor: SessionUser,
) {
  const images = rows.length
    ? await db
        .select({ id: communityImages.id, postId: communityImages.postId })
        .from(communityImages)
        .where(
          inArray(
            communityImages.postId,
            rows.map((row) => row.id),
          ),
        )
        .orderBy(asc(communityImages.position))
    : []
  return rows.map((post) => ({
    id: post.id,
    title: post.title,
    content: post.content,
    createdAt: post.createdAt.toISOString(),
    authorLabel: "楼主",
    isOwn: post.authorId === actor.id,
    canDelete: post.authorId === actor.id || actor.role === "ADMIN",
    commentCount: post.commentCount,
    profileSnapshot: post.profileSnapshot,
    imageUrls: images
      .filter((image) => image.postId === post.id)
      .map((image) => `/api/community/images/${image.id}`),
  }))
}
async function requireActor(work: (actor: SessionUser) => Promise<Response>) {
  const actor = await getSessionUser()
  if (!actor) return failure("UNAUTHORIZED", "请先登录", 401)
  try {
    return await work(actor)
  } catch (error) {
    console.error("[community]", error)
    return failure("INTERNAL_ERROR", "社区暂时不可用，请稍后重试", 500)
  }
}

export function communityFeed(request: Request) {
  return requireActor(async (actor) => {
    const page = pageOf(request)
    if (page === null) return failure("VALIDATION_ERROR", "页码不合法", 400)
    const rows = await db
      .select(columns)
      .from(communityPosts)
      .orderBy(desc(communityPosts.createdAt), desc(communityPosts.id))
      .offset(page * 20)
      .limit(21)
    return success({
      posts: await serializePosts(rows.slice(0, 20), actor),
      hasMore: rows.length > 20,
    })
  })
}
export function createCommunityPost(request: Request) {
  return requireActor(async (actor) => {
    const raw = await readBody(request, 4_300_000).catch(() => null)
    const parsed = PostInput.safeParse(raw)
    if (!parsed.success)
      return failure(
        "VALIDATION_ERROR",
        "标题、正文或图片不合法（最多 3 张）",
        400,
      )
    for (const value of parsed.data.images) {
      if (validateTaskImageDataUrl(value) || !validImage(value))
        return failure(
          "VALIDATION_ERROR",
          "请上传有效的 JPEG、PNG 或 WebP 图片，每张不超过 1MB",
          400,
        )
    }
    const created = await db.transaction(async (tx) => {
      const [post] = await tx
        .insert(communityPosts)
        .values({
          authorId: actor.id,
          title: parsed.data.title,
          content: parsed.data.content,
        })
        .returning({ id: communityPosts.id })
      if (parsed.data.images.length)
        await tx.insert(communityImages).values(
          parsed.data.images.map((data, position) => ({
            postId: post.id,
            data,
            position,
          })),
        )
      return post
    })
    return success(created, { status: 201 })
  })
}
function validImage(value: string) {
  const image = parseTaskImageDataUrl(value)
  if (!image || image.bytes.length < 12) return false
  const b = image.bytes
  if (image.mimeType === "image/jpeg")
    return b[0] === 255 && b[1] === 216 && b[2] === 255
  if (image.mimeType === "image/png")
    return (
      b[0] === 137 &&
      Buffer.from(b.slice(1, 8)).equals(
        Buffer.from([80, 78, 71, 13, 10, 26, 10]),
      )
    )
  return (
    Buffer.from(b.slice(0, 4)).toString() === "RIFF" &&
    Buffer.from(b.slice(8, 12)).toString() === "WEBP"
  )
}
export function communityDetail(request: Request, id: string) {
  return requireActor(async (actor) => {
    if (!Id.safeParse(id).success)
      return failure("NOT_FOUND", "帖子不存在", 404)
    const page = pageOf(request)
    if (page === null) return failure("VALIDATION_ERROR", "页码不合法", 400)
    const [post] = await db
      .select(columns)
      .from(communityPosts)
      .where(eq(communityPosts.id, id))
      .limit(1)
    if (!post) return failure("NOT_FOUND", "帖子不存在", 404)
    const rows = await db
      .select()
      .from(communityComments)
      .where(eq(communityComments.postId, id))
      .orderBy(asc(communityComments.createdAt), asc(communityComments.id))
      .offset(page * 30)
      .limit(31)
    return success({
      post: (await serializePosts([post], actor))[0],
      hasMore: rows.length > 30,
      comments: rows.slice(0, 30).map((comment) => ({
        id: comment.id,
        content: comment.content,
        createdAt: comment.createdAt.toISOString(),
        authorLabel: label(id, comment.authorId, post.authorId),
        isAuthor: comment.authorId === post.authorId,
        isOwn: comment.authorId === actor.id,
        canDelete: comment.authorId === actor.id || actor.role === "ADMIN",
      })),
    })
  })
}
export function addCommunityComment(request: Request, id: string) {
  return requireActor(async (actor) => {
    if (!Id.safeParse(id).success)
      return failure("NOT_FOUND", "帖子不存在", 404)
    const parsed = CommentInput.safeParse(
      await readBody(request, 16000).catch(() => null),
    )
    if (!parsed.success)
      return failure("VALIDATION_ERROR", "评论须为 1–2000 字", 400)
    const [post] = await db
      .select({ id: communityPosts.id })
      .from(communityPosts)
      .where(eq(communityPosts.id, id))
      .limit(1)
    if (!post) return failure("NOT_FOUND", "帖子不存在", 404)
    const [comment] = await db
      .insert(communityComments)
      .values({
        postId: id,
        authorId: actor.id,
        content: parsed.data.content,
      })
      .returning({ id: communityComments.id })
    return success(comment, { status: 201 })
  })
}
export function deleteCommunityPost(id: string) {
  return requireActor(async (actor) => {
    if (!Id.safeParse(id).success)
      return failure("NOT_FOUND", "帖子不存在", 404)
    const deleted = await db
      .delete(communityPosts)
      .where(
        and(
          eq(communityPosts.id, id),
          actor.role === "ADMIN"
            ? undefined
            : eq(communityPosts.authorId, actor.id),
        ),
      )
      .returning({ id: communityPosts.id })
    if (!deleted.length)
      return failure("NOT_FOUND", "帖子不存在或不可删除", 404)
    return success({ id })
  })
}
export function deleteCommunityComment(id: string) {
  return requireActor(async (actor) => {
    if (!Id.safeParse(id).success)
      return failure("NOT_FOUND", "评论不存在", 404)
    const deleted = await db
      .delete(communityComments)
      .where(
        and(
          eq(communityComments.id, id),
          actor.role === "ADMIN"
            ? undefined
            : eq(communityComments.authorId, actor.id),
        ),
      )
      .returning({ id: communityComments.id })
    if (!deleted.length)
      return failure("NOT_FOUND", "评论不存在或不可删除", 404)
    return success({ id })
  })
}
export function communityImage(id: string) {
  return requireActor(async () => {
    if (!Id.safeParse(id).success) return new Response(null, { status: 404 })
    const [row] = await db
      .select({ data: communityImages.data })
      .from(communityImages)
      .where(eq(communityImages.id, id))
      .limit(1)
    const image = row ? parseTaskImageDataUrl(row.data) : null
    if (!image) return new Response(null, { status: 404 })
    return new Response(image.bytes, {
      headers: {
        "Content-Type": image.mimeType,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    })
  })
}
