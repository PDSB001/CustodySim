import { randomUUID } from "node:crypto"

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
      { conversationId: direct.data.id },
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
    const deniedJoin = (await realtimeSocket
      .timeout(5_000)
      .emitWithAck("conversation:join", room.data.id)) as { ok: boolean }
    expect(deniedJoin.ok).toBe(false)
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
      adminAfterRead.data.find(
        (conversation) => conversation.id === direct.data.id,
      )?.unreadCount,
    ).toBe(0)
    const senderView = await call<Array<{ id: string; readCount: number }>>(
      liu,
      "get",
      `/api/chat/conversations/${direct.data.id}/messages`,
    )
    expect(
      senderView.data.find((item) => item.id === message.data.id)?.readCount,
    ).toBe(2)
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
  await expect(page.getByRole("heading", { name: "监室通信" })).toBeVisible()
  await expect(page.getByRole("button", { name: "发起私聊" })).toBeVisible()
  await expect(page.getByText("会话", { exact: true })).toBeVisible()
  const completed = page.locator("details").filter({
    has: page.getByText("已处理申请", { exact: true }),
  })
  await expect(completed).toBeVisible()
  await expect(completed).not.toHaveAttribute("open", "")
  await completed.locator("summary").click()
  await expect(completed.getByText(/已批准|已拒绝/).first()).toBeVisible()
})

test("管理员已处理的私聊审批默认折叠", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chrome", "折叠交互仅需执行一次")
  await page.goto("/login")
  await page.getByLabel("账号").fill("rank_admin")
  await page.getByLabel("密码").fill("Demo12345")
  await page.getByRole("button", { name: /登\s*录/ }).click()
  await expect(page).toHaveURL("/")
  await page.goto("/chats")
  const completed = page.locator("details").filter({
    has: page.getByText("已处理申请", { exact: true }),
  })
  await expect(completed).toBeVisible()
  await expect(completed).not.toHaveAttribute("open", "")
  await completed.locator("summary").click()
  await expect(completed).toHaveAttribute("open", "")
  await expect(completed.getByText(/已批准|已拒绝/).first()).toBeVisible()
})

/** 1×1 PNG，用于验证图片消息链路（体积远小于 1 MB 上限）。 */
const tinyPngBase64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8AAAwAB/wF/T9ziAAAAAElFTkSuQmCC"

test("聊天图片消息：类型、体积校验与会话摘要", async ({}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chrome", "API 链路仅需执行一次")
  const [liu, zhou] = await Promise.all([
    loginApi("rank_101_liu"),
    loginApi("rank_101_zhou"),
  ])
  try {
    const candidates = await call<
      Array<{ id: string; name: string; sameRoom: boolean }>
    >(liu, "get", "/api/chat/candidates")
    const roommate = candidates.data.find(
      (candidate) => candidate.name === "周宁",
    )
    if (!roommate) throw new Error("聊天演示账号不完整")
    const direct = await call<{ id: string }>(
      liu,
      "post",
      "/api/chat/conversations",
      { kind: "DIRECT", targetUserId: roommate.id },
    )

    // 负例：不在白名单的格式必须被拒，且给出中文原因
    const rejected = await liu.post(
      `/api/chat/conversations/${direct.data.id}/messages`,
      {
        data: {
          type: "IMAGE",
          content: "data:image/gif;base64,R0lGODlhAQABAA",
        },
      },
    )
    expect(rejected.status()).toBe(400)
    const rejectedPayload = (await rejected.json()) as ApiPayload<unknown>
    expect(rejectedPayload.success).toBe(false)
    if (!rejectedPayload.success)
      expect(rejectedPayload.error.message).toContain("图片")

    const imageDataUrl = `data:image/png;base64,${tinyPngBase64}`
    // 当前协议（浏览器 / 代际 ≥ 2）不再内联 data URL：`content` 为 null，只给图片端点地址。
    const sent = await call<{
      id: string
      type: string
      content: string | null
      hasImage: boolean
      imageUrl: string | null
    }>(liu, "post", `/api/chat/conversations/${direct.data.id}/messages`, {
      type: "IMAGE",
      content: imageDataUrl,
    })
    expect(sent.data).toMatchObject({
      type: "IMAGE",
      content: null,
      hasImage: true,
      imageUrl: `/api/chat/messages/${sent.data.id}/image`,
    })
    const mixed = await call<{
      id: string
      type: string
      content: string | null
      caption: string | null
      imageUrl: string | null
    }>(liu, "post", `/api/chat/conversations/${direct.data.id}/messages`, {
      type: "IMAGE",
      content: imageDataUrl,
      caption: "同一条图文消息",
    })
    expect(mixed.data).toMatchObject({
      type: "IMAGE",
      content: null,
      caption: "同一条图文消息",
      imageUrl: `/api/chat/messages/${mixed.data.id}/image`,
    })

    // 接收方拿到的也是端点地址；图片本身从端点按字节取回，需与原始 PNG 完全一致。
    const received = await call<
      Array<{
        id: string
        type: string
        content: string | null
        caption: string | null
        imageUrl: string | null
      }>
    >(zhou, "get", `/api/chat/conversations/${direct.data.id}/messages`)
    expect(
      received.data.find((item) => item.id === sent.data.id),
    ).toMatchObject({
      type: "IMAGE",
      content: null,
      imageUrl: `/api/chat/messages/${sent.data.id}/image`,
    })
    expect(
      received.data.find((item) => item.id === mixed.data.id),
    ).toMatchObject({
      type: "IMAGE",
      content: null,
      caption: "同一条图文消息",
    })
    const image = await zhou.get(sent.data.imageUrl ?? "")
    expect(image.status()).toBe(200)
    expect(image.headers()["content-type"]).toBe("image/png")
    // 内容按消息 ID 不可变：允许浏览器长期强缓存，同一张图只下载一次。
    expect(image.headers()["cache-control"]).toContain("immutable")
    expect((await image.body()).toString("base64")).toBe(tinyPngBase64)

    // 未登录拿不到图片：鉴权与消息列表同源。
    const anonymous = await request.newContext({ baseURL: integrationBaseUrl })
    try {
      expect((await anonymous.get(sent.data.imageUrl ?? "")).status()).toBe(401)
    } finally {
      await anonymous.dispose()
    }

    // 会话列表不把 data URL 下发出去，折叠成 [图片]
    const conversations = await call<
      Array<{ id: string; lastMessage: { content: string | null } | null }>
    >(liu, "get", "/api/chat/conversations")
    expect(
      conversations.data.find((item) => item.id === direct.data.id)?.lastMessage
        ?.content,
    ).toBe("[图片] 同一条图文消息")

    // 代际 1 的已发布 App 仍按老形态内联 data URL，否则它会看不到图片。
    const legacy = await liu.post(
      `/api/chat/conversations/${direct.data.id}/messages`,
      {
        headers: { "X-CustodySim-Client": "android-app/1" },
        data: { type: "IMAGE", content: imageDataUrl },
      },
    )
    const legacyPayload = (await legacy.json()) as ApiPayload<{
      content: string | null
      hasImage: boolean
      imageUrl: string | null
    }>
    expect(legacyPayload.success).toBe(true)
    if (legacyPayload.success) {
      expect(legacyPayload.data.content).toBe(imageDataUrl)
      expect(legacyPayload.data.hasImage).toBe(true)
      expect(legacyPayload.data.imageUrl).toBeNull()
    }

    // 非图片消息与不存在的消息一律 404，不区分失败原因。
    const text = await call<{ id: string }>(
      liu,
      "post",
      `/api/chat/conversations/${direct.data.id}/messages`,
      { content: "纯文本，没有图片" },
    )
    expect(
      (await zhou.get(`/api/chat/messages/${text.data.id}/image`)).status(),
    ).toBe(404)
    expect(
      (await zhou.get(`/api/chat/messages/${randomUUID()}/image`)).status(),
    ).toBe(404)

    // 撤回后与文本消息一致：不再下发内容，图片端点也不再给图。
    await call(liu, "post", `/api/chat/messages/${mixed.data.id}/recall`)
    const recalled = await call<
      Array<{
        id: string
        content: string | null
        caption: string | null
        recalledAt: string | null
        imageUrl: string | null
      }>
    >(zhou, "get", `/api/chat/conversations/${direct.data.id}/messages`)
    expect(
      recalled.data.find((item) => item.id === mixed.data.id),
    ).toMatchObject({
      content: null,
      caption: null,
      imageUrl: null,
      recalledAt: expect.any(String),
    })
    expect(
      (await zhou.get(`/api/chat/messages/${mixed.data.id}/image`)).status(),
    ).toBe(404)
  } finally {
    await Promise.all([liu.dispose(), zhou.dispose()])
  }
})

test("聊天工作台可以发送并渲染图片消息", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chrome", "图片上传仅需执行一次")
  // 先确保存在一个群聊会话，避免工作面落在"先选一个会话"的空态上
  const liu = await loginApi("rank_101_liu")
  try {
    await call(liu, "post", "/api/chat/conversations", { kind: "ROOM" })
  } finally {
    await liu.dispose()
  }
  await page.goto("/login")
  await page.getByLabel("账号").fill("rank_101_liu")
  await page.getByLabel("密码").fill("Demo12345")
  await page.getByRole("button", { name: /登\s*录/ }).click()
  await expect(page).toHaveURL("/my")
  await page.goto("/my/chat")
  await expect(page.getByRole("heading", { name: "监室通信" })).toBeVisible()

  // 注意：「发起私聊」按钮文案里也含"私聊"，这里只按"群聊"定位会话，
  // 否则会点开对话框、输入区被遮挡。
  await page.getByRole("button").filter({ hasText: "群聊" }).first().click()

  // 输入区必须已经渲染出来（选到会话才会有）
  await expect(
    page.getByPlaceholder("输入消息，Enter 发送，Shift+Enter 换行"),
  ).toBeVisible()

  // 通过真实的上传输入选择图片：浏览器压缩后以 data URL 发送
  await page.getByLabel("选择图片").setInputFiles({
    name: "chat-image.png",
    mimeType: "image/png",
    buffer: Buffer.from(tinyPngBase64, "base64"),
  })
  const sendImage = page.getByRole("button", { name: "发送图片" })
  await expect(sendImage).toBeEnabled()
  await sendImage.click()

  // 发送成功后输入区复位，且消息气泡通过独立端点渲染出图片本体（浏览器带 cookie 也能取回）
  await expect(page.getByRole("button", { name: /^发送$/ })).toBeVisible()
  const chatImage = page.locator('img[src*="/api/chat/messages/"]').first()
  await expect(chatImage).toBeVisible()
  // 真正解码成功才算通：只出现元素而拿不到字节（鉴权失败）时 naturalWidth 会是 0。
  await expect
    .poll(() =>
      chatImage.evaluate((node) => (node as HTMLImageElement).naturalWidth),
    )
    .toBeGreaterThan(0)
})

test("会话内轮询只发增量请求，不再每 10 秒重取整段历史", async ({
  page,
}, testInfo) => {
  test.slow()
  test.skip(testInfo.project.name !== "desktop-chrome", "轮询策略仅需执行一次")
  // 先确保有一个群聊会话且里面有消息，避免工作面落在空态上。
  const liu = await loginApi("rank_101_liu")
  try {
    const room = await call<{ id: string }>(
      liu,
      "post",
      "/api/chat/conversations",
      { kind: "ROOM" },
    )
    await call(
      liu,
      "post",
      `/api/chat/conversations/${room.data.id}/messages`,
      {
        content: "轮询策略回归样本",
      },
    )
  } finally {
    await liu.dispose()
  }

  // 只看消息列表接口：带 after= 的是增量轮询，其余是整段取（首次打开 / 上拉加载更早）。
  const incremental: string[] = []
  const fullPage: string[] = []
  page.on("request", (requestEvent) => {
    const url = requestEvent.url()
    if (requestEvent.method() !== "GET") return
    if (!/\/api\/chat\/conversations\/[^/]+\/messages/.test(url)) return
    const target = url.includes("after=") ? incremental : fullPage
    target.push(url)
  })

  await page.goto("/login")
  await page.getByLabel("账号").fill("rank_101_liu")
  await page.getByLabel("密码").fill("Demo12345")
  await page.getByRole("button", { name: /登\s*录/ }).click()
  await expect(page).toHaveURL("/my")
  await page.goto("/my/chat")
  await page.getByRole("button").filter({ hasText: "群聊" }).first().click()
  await expect(
    page.getByPlaceholder("输入消息，Enter 发送，Shift+Enter 换行"),
  ).toBeVisible()

  // 先等首屏稳定（开发模式 effect 可能触发两次整段取），再记基线。
  await page.waitForTimeout(2_000)
  const baseline = fullPage.length
  expect(baseline).toBeGreaterThan(0)

  // 跨过两个轮询周期：应当只出现增量请求（空数组也算一次），整段取不再增加。
  // 旧实现是 useInfiniteQuery 上的 refetchInterval，会把每页历史反复重拉，
  // 有任何一张图片在窗口里就是每次数 MB —— 这两条断言就是钉住这一点。
  await page.waitForTimeout(11_000)
  expect(incremental.length).toBeGreaterThan(0)
  expect(fullPage.length).toBe(baseline)
})
