import { expect, request, test, type APIRequestContext } from "@playwright/test"
import { io, type Socket } from "socket.io-client"

type ApiPayload<T> =
  | { success: true; data: T }
  | { success: false; error: { code: string; message: string } }

const integrationBaseUrl = process.env.E2E_BASE_URL ?? "http://127.0.0.1:3100"

async function loginApi(username: string) {
  const context = await request.newContext({ baseURL: integrationBaseUrl })
  const response = await context.post("/api/auth/login", {
    data: { username, password: "Demo12345" },
  })
  expect(response.ok()).toBe(true)
  const payload = (await response.json()) as ApiPayload<unknown>
  expect(payload.success).toBe(true)
  return context
}

async function call<T>(
  context: APIRequestContext,
  method: "get" | "post" | "patch",
  url: string,
  data?: unknown,
) {
  const response = await context[method](
    url,
    data === undefined ? {} : { data },
  )
  const payload = (await response.json()) as ApiPayload<T>
  expect(payload.success, JSON.stringify(payload)).toBe(true)
  if (!payload.success) throw new Error(payload.error.message)
  return { data: payload.data, status: response.status() }
}

test("聊天完整链路：同监室、撤回、跨监室审批", async ({}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chrome", "API 链路仅需执行一次")
  const [liu, zhou, admin] = await Promise.all([
    loginApi("rank_101_liu"),
    loginApi("rank_101_zhou"),
    loginApi("rank_admin"),
  ])
  let realtimeSocket: Socket | null = null
  try {
    const candidates = await call<
      Array<{ id: string; name: string; sameRoom: boolean }>
    >(liu, "get", "/api/chat/candidates")
    const roommate = candidates.data.find(
      (candidate) => candidate.name === "周宁",
    )
    const crossRoom = candidates.data.find(
      (candidate) => candidate.name === "孙敏",
    )
    expect(roommate?.sameRoom).toBe(true)
    expect(crossRoom?.sameRoom).toBe(false)
    if (!roommate || !crossRoom) throw new Error("聊天演示账号不完整")

    const room = await call<{ id: string }>(
      liu,
      "post",
      "/api/chat/conversations",
      { kind: "ROOM" },
    )
    expect(room.data.id).toBeTruthy()

    const direct = await call<{ id: string }>(
      liu,
      "post",
      "/api/chat/conversations",
      { kind: "DIRECT", targetUserId: roommate.id },
    )
    const realtime = await call<{ token: string }>(
      liu,
      "post",
      "/api/chat/realtime-token",
    )
    realtimeSocket = io("http://127.0.0.1:3001", {
      path: "/socket.io",
      auth: { token: realtime.data.token },
      transports: ["websocket"],
    })
    await new Promise<void>((resolve, reject) => {
      realtimeSocket!.once("connect", resolve)
      realtimeSocket!.once("connect_error", reject)
    })
    const joinResult = (await realtimeSocket
      .timeout(5_000)
      .emitWithAck("conversation:join", direct.data.id)) as { ok: boolean }
    expect(joinResult.ok).toBe(true)

    const messageText = `同监室链路验证 ${Date.now()}`
    const realtimeEvent = new Promise<{ type: string; conversationId: string }>(
      (resolve, reject) => {
        const timeout = setTimeout(
          () => reject(new Error("未收到实时消息事件")),
          5_000,
        )
        realtimeSocket!.once(
          "chat:event",
          (event: { type: string; conversationId: string }) => {
            clearTimeout(timeout)
            resolve(event)
          },
        )
      },
    )
    const message = await call<{ id: string }>(
      liu,
      "post",
      `/api/chat/conversations/${direct.data.id}/messages`,
      { content: messageText },
    )
    await expect(realtimeEvent).resolves.toMatchObject({
      type: "message.created",
      conversationId: direct.data.id,
    })
    const received = await call<Array<{ id: string; content: string | null }>>(
      zhou,
      "get",
      `/api/chat/conversations/${direct.data.id}/messages`,
    )
    expect(received.data.some((item) => item.content === messageText)).toBe(
      true,
    )
    const markedRead = await call<{ readCount: number }>(
      zhou,
      "post",
      `/api/chat/conversations/${direct.data.id}/read`,
      { messageId: message.data.id },
    )
    expect(markedRead.data.readCount).toBeGreaterThan(0)
    const afterRead = await call<Array<{ id: string; unreadCount: number }>>(
      zhou,
      "get",
      "/api/chat/conversations",
    )
    const readConversation = afterRead.data.find(
      (conversation: { id: string }) => conversation.id === direct.data.id,
    )
    expect(readConversation?.unreadCount).toBe(0)
    const adminMarkedRead = await call<{ readCount: number }>(
      admin,
      "post",
      `/api/chat/conversations/${direct.data.id}/read`,
      { messageId: message.data.id },
    )
    expect(adminMarkedRead.data.readCount).toBeGreaterThan(0)
    const adminAfterRead = await call<
      Array<{ id: string; unreadCount: number }>
    >(admin, "get", "/api/chat/conversations")
    expect(
      adminAfterRead.data.find((conversation) => conversation.id === direct.data.id)
        ?.unreadCount,
    ).toBe(0)
    await call(liu, "post", `/api/chat/messages/${message.data.id}/recall`)
    const recalled = await call<
      Array<{ id: string; content: string | null; recalledAt: string | null }>
    >(zhou, "get", `/api/chat/conversations/${direct.data.id}/messages`)
    expect(
      recalled.data.find((item) => item.id === message.data.id),
    ).toMatchObject({
      content: null,
      recalledAt: expect.any(String),
    })

    const cross = await call<{ id?: string; requestId?: string }>(
      liu,
      "post",
      "/api/chat/conversations",
      {
        kind: "DIRECT",
        targetUserId: crossRoom.id,
        reason: "端到端验证跨监室审批",
      },
    )
    if (cross.status === 202) {
      expect(cross.data.requestId).toBeTruthy()
      await call(admin, "patch", `/api/chat/requests/${cross.data.requestId}`, {
        result: "APPROVED",
        comment: "自动化验证通过",
      })
    } else {
      expect(cross.data.id).toBeTruthy()
    }
    const conversations = await call<
      Array<{ type: string; members: Array<{ name: string }> }>
    >(liu, "get", "/api/chat/conversations")
    expect(
      conversations.data.some(
        (conversation) =>
          conversation.type === "DIRECT" &&
          conversation.members.some((member) => member.name === "孙敏"),
      ),
    ).toBe(true)
  } finally {
    realtimeSocket?.disconnect()
    await Promise.all([liu.dispose(), zhou.dispose(), admin.dispose()])
  }
})

test("被监管人可以打开响应式聊天工作台", async ({ page }) => {
  await page.goto("/login")
  await page.getByLabel("账号").fill("rank_101_liu")
  await page.getByLabel("密码").fill("Demo12345")
  await page.getByRole("button", { name: /登\s*录/ }).click()
  await expect(page).toHaveURL("/my")
  await page.goto("/my/chat")
  await expect(page.getByRole("heading", { name: "监室聊天" })).toBeVisible()
  await expect(page.getByRole("button", { name: "发起私聊" })).toBeVisible()
  await expect(page.getByText("会话", { exact: true })).toBeVisible()
})
