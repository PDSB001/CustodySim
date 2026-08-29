"use client"

import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import {
  Check,
  Clock3,
  MessageCircle,
  MessageSquarePlus,
  RotateCcw,
  Send,
  ShieldCheck,
  Users,
  X,
} from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"
import { io, type Socket } from "socket.io-client"
import { z } from "zod"

import { formatDate, requestApi } from "@/components/shared/api-client"
import { EmptyState } from "@/components/shared/empty-state"
import { PageHeader } from "@/components/shared/page-header"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { toast } from "@/components/ui/toast"
import type { SessionUser } from "@/lib/session"

const ConversationSchema = z.object({
  id: z.string(),
  type: z.string(),
  title: z.string(),
  roomOrganizationId: z.string().nullable(),
  members: z.array(z.object({ id: z.string(), name: z.string() })),
  lastMessage: z
    .object({
      id: z.string(),
      content: z.string().nullable(),
      createdAt: z.string(),
    })
    .nullable(),
  unreadCount: z.number(),
})
const ConversationsSchema = z.array(ConversationSchema)

const MessageSchema = z.object({
  id: z.string(),
  senderId: z.string().nullable(),
  senderName: z.string().nullable(),
  type: z.string(),
  content: z.string().nullable(),
  recalledAt: z.string().nullable(),
  createdAt: z.string(),
  readCount: z.number(),
})
const MessagesSchema = z.array(MessageSchema)

const CandidateSchema = z.object({
  id: z.string(),
  name: z.string(),
  organizationId: z.string().nullable(),
  roomName: z.string().nullable(),
  sameRoom: z.boolean(),
})
const CandidatesSchema = z.array(CandidateSchema)

const ChatRequestSchema = z.object({
  id: z.string(),
  requesterId: z.string(),
  targetId: z.string(),
  requesterName: z.string(),
  targetName: z.string(),
  reason: z.string(),
  status: z.string(),
  reviewComment: z.string().nullable(),
  reviewerName: z.string().nullable(),
  reviewedAt: z.string().nullable(),
  createdAt: z.string(),
})
const ChatRequestsSchema = z.array(ChatRequestSchema)

const RealtimeTokenSchema = z.object({
  token: z.string(),
  expiresInSeconds: z.number(),
})

function initials(name: string) {
  return name.trim().slice(0, 2) || "聊"
}

function useChatRealtime(selectedConversationId: string | null) {
  const client = useQueryClient()
  const socketRef = useRef<Socket | null>(null)
  const token = useQuery({
    queryKey: ["chat-realtime-token"],
    queryFn: () =>
      requestApi("/api/chat/realtime-token", RealtimeTokenSchema, {
        method: "POST",
      }),
    staleTime: 4 * 60 * 1000,
    refetchInterval: 4 * 60 * 1000,
    retry: false,
  })

  useEffect(() => {
    if (!token.data?.token) return
    const developmentUrl =
      process.env.NODE_ENV === "production"
        ? undefined
        : `${window.location.protocol}//${window.location.hostname}:3001`
    const socket = io(
      process.env.NEXT_PUBLIC_CHAT_REALTIME_URL || developmentUrl,
      {
        path: "/socket.io",
        auth: { token: token.data.token },
        transports: ["websocket", "polling"],
      },
    )
    socketRef.current = socket
    socket.on("chat:event", (event: { conversationId?: string }) => {
      client.invalidateQueries({ queryKey: ["chat-conversations"] })
      if (event.conversationId)
        client.invalidateQueries({
          queryKey: ["chat-messages", event.conversationId],
        })
    })
    return () => {
      socket.disconnect()
      socketRef.current = null
    }
  }, [client, token.data?.token])

  useEffect(() => {
    const socket = socketRef.current
    if (!socket || !selectedConversationId) return
    socket.emit("conversation:join", selectedConversationId)
    return () => {
      socket.emit("conversation:leave", selectedConversationId)
    }
  }, [selectedConversationId, token.data?.token])
}

function NewConversationDialog() {
  const client = useQueryClient()
  const [open, setOpen] = useState(false)
  const [targetId, setTargetId] = useState("")
  const [reason, setReason] = useState("")
  const candidates = useQuery({
    queryKey: ["chat-candidates"],
    queryFn: () => requestApi("/api/chat/candidates", CandidatesSchema),
    enabled: open,
  })
  const selected = candidates.data?.find(
    (candidate) => candidate.id === targetId,
  )
  const createDirect = useMutation({
    mutationFn: () =>
      requestApi("/api/chat/conversations", z.unknown(), {
        method: "POST",
        body: JSON.stringify({
          kind: "DIRECT",
          targetUserId: targetId,
          reason: selected?.sameRoom ? undefined : reason,
        }),
      }),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["chat-conversations"] })
      client.invalidateQueries({ queryKey: ["chat-requests"] })
      client.invalidateQueries({ queryKey: ["chat-realtime-token"] })
      toast.success(selected?.sameRoom ? "私聊已创建" : "跨监室申请已提交")
      setOpen(false)
      setTargetId("")
      setReason("")
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "创建私聊失败"),
  })
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <MessageSquarePlus />
          发起私聊
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>发起私聊</DialogTitle>
          <DialogDescription>
            同监室可直接开始；跨监室需要管理员批准。
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label>聊天对象</Label>
            <Select value={targetId} onValueChange={setTargetId}>
              <SelectTrigger>
                <SelectValue placeholder="请选择被监管人" />
              </SelectTrigger>
              <SelectContent>
                {candidates.data?.map((candidate) => (
                  <SelectItem key={candidate.id} value={candidate.id}>
                    {candidate.name} · {candidate.roomName ?? "未分配监室"}
                    {candidate.sameRoom ? "（同监室）" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {selected && !selected.sameRoom ? (
            <div className="space-y-2">
              <Label>申请原因</Label>
              <Textarea
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder="说明跨监室私聊的必要原因"
                maxLength={500}
              />
            </div>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            取消
          </Button>
          <Button
            disabled={
              createDirect.isPending ||
              !targetId ||
              Boolean(selected && !selected.sameRoom && !reason.trim())
            }
            onClick={() => createDirect.mutate()}
          >
            {selected?.sameRoom ? "开始私聊" : "提交申请"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function RequestReviewPanel({ role }: { role: SessionUser["role"] }) {
  const client = useQueryClient()
  const requests = useQuery({
    queryKey: ["chat-requests"],
    queryFn: () => requestApi("/api/chat/requests", ChatRequestsSchema),
    refetchInterval: 30_000,
  })
  const review = useMutation({
    mutationFn: ({
      id,
      result,
    }: {
      id: string
      result: "APPROVED" | "REJECTED"
    }) =>
      requestApi(`/api/chat/requests/${id}`, z.unknown(), {
        method: "PATCH",
        body: JSON.stringify({ result }),
      }),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["chat-requests"] })
      client.invalidateQueries({ queryKey: ["chat-conversations"] })
      client.invalidateQueries({ queryKey: ["chat-realtime-token"] })
      toast.success("申请已处理")
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "审批失败"),
  })
  if (!requests.data?.length) return null
  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2">
        <ShieldCheck className="size-4" />
        <h2 className="font-semibold">
          {role === "ADMIN" ? "跨监室私聊审批" : "我的跨监室申请"}
        </h2>
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        {requests.data.map((item) => (
          <Card key={item.id}>
            <CardContent className="space-y-3 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-medium">
                    {item.requesterName} → {item.targetName}
                  </p>
                  <p className="text-muted-foreground mt-1 text-xs">
                    {formatDate(item.createdAt)}
                  </p>
                </div>
                <Badge
                  variant={item.status === "PENDING" ? "outline" : "secondary"}
                >
                  {item.status === "PENDING"
                    ? "待审批"
                    : item.status === "APPROVED"
                      ? "已批准"
                      : "已拒绝"}
                </Badge>
              </div>
              <p className="text-muted-foreground text-sm leading-6">
                {item.reason}
              </p>
              {role === "ADMIN" && item.status === "PENDING" ? (
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    onClick={() =>
                      review.mutate({ id: item.id, result: "APPROVED" })
                    }
                  >
                    <Check />
                    批准
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      review.mutate({ id: item.id, result: "REJECTED" })
                    }
                  >
                    <X />
                    拒绝
                  </Button>
                </div>
              ) : null}
            </CardContent>
          </Card>
        ))}
      </div>
    </section>
  )
}

export function ChatWorkspace({ user }: { user: SessionUser }) {
  const client = useQueryClient()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [draft, setDraft] = useState("")
  const [now, setNow] = useState(() => Date.now())
  const messagesEndRef = useRef<HTMLDivElement | null>(null)
  const conversations = useQuery({
    queryKey: ["chat-conversations"],
    queryFn: () => requestApi("/api/chat/conversations", ConversationsSchema),
    refetchInterval: 30_000,
  })
  const selected =
    conversations.data?.find((item) => item.id === selectedId) ?? null
  const messages = useInfiniteQuery({
    queryKey: ["chat-messages", selectedId],
    queryFn: ({ pageParam }) =>
      requestApi(
        `/api/chat/conversations/${selectedId}/messages${pageParam ? `?before=${encodeURIComponent(pageParam)}` : ""}`,
        MessagesSchema,
      ),
    enabled: Boolean(selectedId),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) =>
      lastPage.length === 50 ? lastPage[0]?.createdAt : undefined,
    refetchInterval: 10_000,
  })
  const messageList = useMemo(
    () => (messages.data ? [...messages.data.pages].reverse().flat() : []),
    [messages.data],
  )
  const latestMessageId = messageList.at(-1)?.id
  const latestSenderId = messageList.at(-1)?.senderId
  useChatRealtime(selectedId)

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 15_000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    if (!selectedId && conversations.data?.[0])
      setSelectedId(conversations.data[0].id)
  }, [conversations.data, selectedId])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
    if (!selectedId || !latestMessageId || latestSenderId === user.id) return
    requestApi(
      `/api/chat/conversations/${selectedId}/read`,
      z.object({ messageId: z.string() }),
      { method: "POST", body: JSON.stringify({ messageId: latestMessageId }) },
    )
      .then(() =>
        client.invalidateQueries({ queryKey: ["chat-conversations"] }),
      )
      .catch(() => undefined)
  }, [client, latestMessageId, latestSenderId, selectedId, user.id])

  const ensureRoom = useMutation({
    mutationFn: () =>
      requestApi("/api/chat/conversations", ConversationSchema, {
        method: "POST",
        body: JSON.stringify({ kind: "ROOM" }),
      }),
    onSuccess: (conversation) => {
      client.invalidateQueries({ queryKey: ["chat-conversations"] })
      client.invalidateQueries({ queryKey: ["chat-realtime-token"] })
      setSelectedId(conversation.id)
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "进入监室群聊失败"),
  })
  const send = useMutation({
    mutationFn: () =>
      requestApi(
        `/api/chat/conversations/${selectedId}/messages`,
        MessageSchema,
        { method: "POST", body: JSON.stringify({ content: draft }) },
      ),
    onSuccess: () => {
      setDraft("")
      client.invalidateQueries({ queryKey: ["chat-messages", selectedId] })
      client.invalidateQueries({ queryKey: ["chat-conversations"] })
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "消息发送失败"),
  })
  const recall = useMutation({
    mutationFn: (messageId: string) =>
      requestApi(
        `/api/chat/messages/${messageId}/recall`,
        z.object({ id: z.string(), recalledAt: z.string() }),
        { method: "POST" },
      ),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["chat-messages", selectedId] })
      client.invalidateQueries({ queryKey: ["chat-conversations"] })
      toast.success("消息已撤回")
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "撤回失败"),
  })
  const roomConversation = useMemo(
    () =>
      conversations.data?.find((conversation) => conversation.type === "ROOM"),
    [conversations.data],
  )

  return (
    <div className="workspace-stack mx-auto max-w-7xl">
      <PageHeader
        eyebrow="沟通中心"
        title={user.role === "SUPERVISED" ? "监室聊天" : "聊天监管"}
        description={
          user.role === "SUPERVISED"
            ? "同监室可直接聊天；跨监室私聊需管理员批准。普通消息保留14天可见。"
            : "查看监管范围内聊天与跨监室申请；监管侧消息最长保留28天。"
        }
        action={
          user.role === "SUPERVISED" ? <NewConversationDialog /> : undefined
        }
      />

      {user.role !== "SUPERVISOR" ? (
        <RequestReviewPanel role={user.role} />
      ) : null}

      <Card className="overflow-hidden">
        <CardContent className="grid min-h-[36rem] p-0 md:grid-cols-[18rem_1fr]">
          <aside className="border-border bg-muted/20 border-b md:border-r md:border-b-0">
            <div className="border-border flex items-center justify-between border-b p-3">
              <p className="text-sm font-semibold">会话</p>
              {user.role === "SUPERVISED" && !roomConversation ? (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={ensureRoom.isPending}
                  onClick={() => ensureRoom.mutate()}
                >
                  <Users />
                  监室群聊
                </Button>
              ) : null}
            </div>
            <div className="max-h-64 overflow-y-auto md:max-h-[32rem]">
              {conversations.data?.map((conversation) => (
                <button
                  key={conversation.id}
                  type="button"
                  className={`border-border flex w-full items-start gap-3 border-b p-3 text-left transition-colors ${
                    selectedId === conversation.id
                      ? "bg-background"
                      : "hover:bg-background/70"
                  }`}
                  onClick={() => setSelectedId(conversation.id)}
                >
                  <Avatar className="mt-0.5 size-9">
                    <AvatarFallback>
                      {conversation.type === "ROOM"
                        ? "群"
                        : initials(conversation.title)}
                    </AvatarFallback>
                  </Avatar>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-medium">
                        {conversation.title}
                      </span>
                      {conversation.unreadCount ? (
                        <Badge className="min-w-5 justify-center px-1.5">
                          {conversation.unreadCount > 99
                            ? "99+"
                            : conversation.unreadCount}
                        </Badge>
                      ) : null}
                    </span>
                    <span className="text-muted-foreground mt-1 block truncate text-xs">
                      {conversation.lastMessage?.content ?? "暂无消息"}
                    </span>
                  </span>
                </button>
              ))}
              {conversations.data?.length === 0 ? (
                <div className="text-muted-foreground p-6 text-center text-sm">
                  暂无会话
                </div>
              ) : null}
            </div>
          </aside>

          <section className="flex min-w-0 flex-col">
            {selected ? (
              <>
                <header className="border-border flex items-center justify-between border-b px-4 py-3">
                  <div>
                    <h2 className="font-semibold">{selected.title}</h2>
                    <p className="text-muted-foreground mt-0.5 text-xs">
                      {selected.type === "ROOM" ? "监室群聊" : "私聊"}
                    </p>
                  </div>
                  <Badge variant="outline">
                    {user.role === "SUPERVISED" ? "14天可见" : "28天监管留存"}
                  </Badge>
                </header>
                <div className="bg-muted/10 flex-1 space-y-4 overflow-y-auto p-4 md:max-h-[26rem]">
                  {messages.hasNextPage ? (
                    <div className="text-center">
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={messages.isFetchingNextPage}
                        onClick={() => messages.fetchNextPage()}
                      >
                        {messages.isFetchingNextPage
                          ? "加载中…"
                          : "加载更早消息"}
                      </Button>
                    </div>
                  ) : null}
                  {messageList.map((message) => {
                    const mine = message.senderId === user.id
                    const recallDeadline =
                      new Date(message.createdAt).getTime() + 5 * 60 * 1000
                    const canRecall =
                      mine && !message.recalledAt && now <= recallDeadline
                    return (
                      <div
                        key={message.id}
                        className={`flex gap-2 ${mine ? "flex-row-reverse" : ""}`}
                      >
                        <Avatar className="size-8 shrink-0">
                          <AvatarFallback>
                            {initials(message.senderName ?? "系统")}
                          </AvatarFallback>
                        </Avatar>
                        <div
                          className={`max-w-[78%] ${mine ? "text-right" : ""}`}
                        >
                          <p className="text-muted-foreground mb-1 text-xs">
                            {message.senderName ?? "系统"} ·{" "}
                            {formatDate(message.createdAt)}
                          </p>
                          <div
                            className={`rounded-2xl px-3 py-2 text-left text-sm leading-6 ${
                              mine
                                ? "bg-brand-600 rounded-tr-sm text-white"
                                : "bg-background border-border rounded-tl-sm border"
                            }`}
                          >
                            {message.recalledAt ? (
                              <span
                                className={
                                  mine
                                    ? "text-white/70"
                                    : "text-muted-foreground"
                                }
                              >
                                消息已撤回
                              </span>
                            ) : (
                              <span className="break-words whitespace-pre-wrap">
                                {message.content}
                              </span>
                            )}
                          </div>
                          <div
                            className={`mt-1 flex items-center gap-2 ${mine ? "justify-end" : ""}`}
                          >
                            {mine ? (
                              <span className="text-muted-foreground text-[11px]">
                                {message.readCount > 1 ? "已读" : "已发送"}
                              </span>
                            ) : null}
                            {canRecall ? (
                              <button
                                type="button"
                                className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-[11px]"
                                onClick={() => recall.mutate(message.id)}
                              >
                                <RotateCcw className="size-3" />
                                撤回
                              </button>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    )
                  })}
                  {messageList.length === 0 ? (
                    <EmptyState
                      icon={MessageCircle}
                      title="还没有消息"
                      description="发送第一条消息开始交流。"
                    />
                  ) : null}
                  <div ref={messagesEndRef} />
                </div>
                <form
                  className="border-border space-y-2 border-t p-3"
                  onSubmit={(event) => {
                    event.preventDefault()
                    if (draft.trim()) send.mutate()
                  }}
                >
                  <Textarea
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && !event.shiftKey) {
                        event.preventDefault()
                        if (draft.trim() && !send.isPending) send.mutate()
                      }
                    }}
                    placeholder="输入消息，Enter 发送，Shift+Enter 换行"
                    maxLength={4000}
                    className="min-h-20 resize-none"
                  />
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-muted-foreground flex items-center gap-1 text-xs">
                      <Clock3 className="size-3" />
                      发送后5分钟内可撤回
                    </p>
                    <Button
                      type="submit"
                      disabled={!draft.trim() || send.isPending}
                    >
                      <Send />
                      发送
                    </Button>
                  </div>
                </form>
              </>
            ) : (
              <div className="grid flex-1 place-items-center p-6">
                <EmptyState
                  icon={MessageCircle}
                  title="选择一个会话"
                  description="从左侧选择群聊或私聊开始交流。"
                />
              </div>
            )}
          </section>
        </CardContent>
      </Card>
    </div>
  )
}
