"use client"

import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import { ArrowLeft, MessageCircle, Plus, Send, Trash2 } from "lucide-react"
import { useState } from "react"
import { z } from "zod"
import { requestApi, formatDate } from "@/components/shared/api-client"
import {
  ImageGallery,
  ImageUploadField,
} from "@/components/shared/image-upload-field"
import { PageHeader } from "@/components/shared/page-header"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { toast } from "@/components/ui/toast"
import {
  CommunityFeedSchema,
  CommunityDetailSchema,
  type CommunityPost,
} from "@/lib/community-contract"

const Saved = z.object({ id: z.string() })
function PostBody({ post }: { post: CommunityPost }) {
  return (
    <div className="space-y-3">
      <p className="text-sm leading-7 break-words whitespace-pre-wrap">
        {post.content}
      </p>
      {post.profileSnapshot ? (
        <dl className="bg-muted/40 space-y-2 rounded-xl p-4">
          {post.profileSnapshot.map((field) => (
            <div key={field.name} className="flex gap-4 text-sm">
              <dt className="text-muted-foreground shrink-0">{field.name}</dt>
              <dd className="break-words">{field.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {post.imageUrls.length ? (
        <ImageGallery value={post.imageUrls} label="帖子图片" />
      ) : null}
    </div>
  )
}
export function CommunityWorkspace() {
  const client = useQueryClient()
  const [selected, setSelected] = useState<string | null>(null)
  const [commentPage, setCommentPage] = useState(0)
  const [compose, setCompose] = useState(false)
  const [title, setTitle] = useState("")
  const [content, setContent] = useState("")
  const [images, setImages] = useState<string[]>([])
  const [comment, setComment] = useState("")
  const feed = useInfiniteQuery({
    queryKey: ["community-feed"],
    queryFn: ({ pageParam }) =>
      requestApi(`/api/community/posts?page=${pageParam}`, CommunityFeedSchema),
    initialPageParam: 0,
    getNextPageParam: (last, pages) =>
      last.hasMore ? pages.length : undefined,
  })
  const detail = useQuery({
    queryKey: ["community-post", selected, commentPage],
    queryFn: () =>
      requestApi(
        `/api/community/posts/${selected}?page=${commentPage}`,
        CommunityDetailSchema,
      ),
    enabled: selected !== null,
  })
  const refresh = async () => {
    await Promise.all([
      client.invalidateQueries({ queryKey: ["community-feed"] }),
      client.invalidateQueries({ queryKey: ["community-post"] }),
    ])
  }
  const publish = useMutation({
    mutationFn: () =>
      requestApi("/api/community/posts", Saved, {
        method: "POST",
        body: JSON.stringify({ title, content, images }),
      }),
    onSuccess: async (post) => {
      setCompose(false)
      setTitle("")
      setContent("")
      setImages([])
      setSelected(post.id)
      setCommentPage(0)
      await refresh()
      toast.success("帖子已发布")
    },
    onError: (error) => toast.error(error.message),
  })
  const reply = useMutation({
    mutationFn: () =>
      requestApi(`/api/community/posts/${selected}/comments`, Saved, {
        method: "POST",
        body: JSON.stringify({ content: comment }),
      }),
    onSuccess: async () => {
      setComment("")
      setCommentPage(0)
      await refresh()
      toast.success("评论已发布")
    },
    onError: (error) => toast.error(error.message),
  })
  const remove = useMutation({
    mutationFn: (item: { type: "posts" | "comments"; id: string }) =>
      requestApi(`/api/community/${item.type}/${item.id}`, Saved, {
        method: "DELETE",
      }),
    onSuccess: async (_result, item) => {
      if (item.type === "posts") {
        setSelected(null)
        setCommentPage(0)
      }
      await refresh()
      toast.success("已删除")
    },
    onError: (error) => toast.error(error.message),
  })
  const open = (id: string) => {
    setSelected(id)
    setCommentPage(0)
    setComment("")
    setCompose(false)
  }
  const deleteItem = (type: "posts" | "comments", id: string) => {
    if (
      window.confirm(type === "posts" ? "删除此帖和全部评论？" : "删除此评论？")
    )
      remove.mutate({ type, id })
  }
  return (
    <div className="space-y-5">
      <PageHeader
        title="匿名社区"
        description="分享日常、交流经验。匿名编号仅在同一帖子内固定；请勿在正文或图片中透露身份。"
      />
      <div className="flex items-center justify-between">
        <p className="text-muted-foreground text-sm">最新帖子 · 登录用户可见</p>
        <Button
          onClick={() => {
            setCompose(!compose)
            setSelected(null)
          }}
        >
          <Plus />
          发布帖子
        </Button>
      </div>
      {compose ? (
        <form
          className="bg-card space-y-4 rounded-2xl border p-5"
          onSubmit={(event) => {
            event.preventDefault()
            publish.mutate()
          }}
        >
          <Input
            aria-label="帖子标题"
            placeholder="标题"
            maxLength={120}
            value={title}
            disabled={publish.isPending}
            onChange={(event) => setTitle(event.target.value)}
          />
          <Textarea
            aria-label="帖子正文"
            placeholder="想分享些什么？"
            maxLength={5000}
            value={content}
            disabled={publish.isPending}
            onChange={(event) => setContent(event.target.value)}
            className="min-h-32"
          />
          <ImageUploadField
            label="帖子图片"
            value={images}
            onChange={setImages}
            disabled={publish.isPending}
            hint="最多 3 张，自动压缩至每张 1MB。"
          />
          <div className="flex gap-2">
            <Button
              type="submit"
              disabled={
                publish.isPending ||
                !title.trim() ||
                (!content.trim() && !images.length)
              }
            >
              <Send />
              {publish.isPending ? "发布中…" : "匿名发布"}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={publish.isPending}
              onClick={() => setCompose(false)}
            >
              取消
            </Button>
          </div>
        </form>
      ) : null}
      {selected ? (
        <section className="bg-card space-y-5 rounded-2xl border p-5">
          <Button variant="ghost" onClick={() => setSelected(null)}>
            <ArrowLeft />
            返回帖子列表
          </Button>
          {detail.isPending ? (
            <p role="status">加载帖子中…</p>
          ) : detail.isError ? (
            <div role="alert">
              <p>{detail.error.message}</p>
              <Button onClick={() => detail.refetch()}>重试</Button>
            </div>
          ) : detail.data ? (
            <>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-xl font-semibold">
                    {detail.data.post.title}
                  </h2>
                  <p className="text-muted-foreground mt-2 text-xs">
                    楼主{detail.data.post.isOwn ? " · 我" : ""} ·{" "}
                    {formatDate(detail.data.post.createdAt)}
                  </p>
                </div>
                {detail.data.post.canDelete ? (
                  <Button
                    variant="ghost"
                    aria-label="删除帖子"
                    disabled={remove.isPending}
                    onClick={() => deleteItem("posts", selected)}
                  >
                    <Trash2 />
                  </Button>
                ) : null}
              </div>
              <PostBody post={detail.data.post} />
              <h3 className="border-t pt-5 font-medium">
                评论 · {detail.data.post.commentCount}
              </h3>
              {detail.data.comments.length ? (
                <div className="divide-y">
                  {detail.data.comments.map((item) => (
                    <article key={item.id} className="py-4">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-muted-foreground text-xs">
                          {item.authorLabel}
                          {item.isOwn ? " · 我" : ""} ·{" "}
                          {formatDate(item.createdAt)}
                        </p>
                        {item.canDelete ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            aria-label="删除评论"
                            disabled={remove.isPending}
                            onClick={() => deleteItem("comments", item.id)}
                          >
                            <Trash2 />
                          </Button>
                        ) : null}
                      </div>
                      <p className="mt-2 text-sm leading-6 break-words whitespace-pre-wrap">
                        {item.content}
                      </p>
                    </article>
                  ))}
                </div>
              ) : (
                <p className="text-muted-foreground text-sm">
                  还没有评论，来聊聊吧。
                </p>
              )}
              <div className="flex gap-2">
                {commentPage > 0 ? (
                  <Button
                    variant="outline"
                    onClick={() => setCommentPage(commentPage - 1)}
                  >
                    上一页评论
                  </Button>
                ) : null}
                {detail.data.hasMore ? (
                  <Button
                    variant="outline"
                    onClick={() => setCommentPage(commentPage + 1)}
                  >
                    下一页评论
                  </Button>
                ) : null}
              </div>
              <form
                className="space-y-3"
                onSubmit={(event) => {
                  event.preventDefault()
                  reply.mutate()
                }}
              >
                <Textarea
                  aria-label="评论内容"
                  placeholder="发表匿名评论…"
                  value={comment}
                  maxLength={2000}
                  disabled={reply.isPending}
                  onChange={(event) => setComment(event.target.value)}
                />
                <Button disabled={reply.isPending || !comment.trim()}>
                  <Send />
                  {reply.isPending ? "发送中…" : "发表评论"}
                </Button>
              </form>
            </>
          ) : null}
        </section>
      ) : !compose ? (
        <div className="space-y-3">
          {feed.isPending ? (
            <p role="status">加载社区中…</p>
          ) : feed.isError ? (
            <div role="alert">
              <p>{feed.error.message}</p>
              <Button onClick={() => feed.refetch()}>重试</Button>
            </div>
          ) : null}
          {feed.data?.pages
            .flatMap((page) => page.posts)
            .map((post) => (
              <article key={post.id} className="bg-card rounded-2xl border p-5">
                <button
                  className="w-full text-left"
                  onClick={() => open(post.id)}
                >
                  <h2 className="text-lg font-semibold">{post.title}</h2>
                  <p className="text-muted-foreground mt-2 line-clamp-2 text-sm">
                    {post.content}
                  </p>
                  <p className="text-muted-foreground mt-4 flex flex-wrap items-center gap-3 text-xs">
                    <span>楼主{post.isOwn ? " · 我" : ""}</span>
                    <span>{formatDate(post.createdAt)}</span>
                    <span className="inline-flex items-center gap-1">
                      <MessageCircle className="size-3" />
                      {post.commentCount}
                    </span>
                    {post.imageUrls.length ? (
                      <span>{post.imageUrls.length} 张图片</span>
                    ) : null}
                    {post.profileSnapshot ? <span>自愿档案分享</span> : null}
                  </p>
                </button>
              </article>
            ))}
          {feed.data && !feed.data.pages[0].posts.length ? (
            <div className="text-muted-foreground rounded-2xl border border-dashed p-10 text-center">
              社区还没有帖子，分享你的第一篇吧。
            </div>
          ) : null}
          {feed.hasNextPage ? (
            <Button
              variant="outline"
              disabled={feed.isFetchingNextPage}
              onClick={() => feed.fetchNextPage()}
            >
              {feed.isFetchingNextPage ? "加载中…" : "加载更多"}
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
