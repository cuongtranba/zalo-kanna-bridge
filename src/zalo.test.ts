import { expect, test } from "bun:test"
import { createBridge, createFileStore, createZaloApi, type KannaApi } from "./index"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

const TOKEN = "test-token-123"
const SECRET = "test-secret-123"

interface SendBody {
  chat_id: string
  text: string
}

function isSendBody(value: unknown): value is SendBody {
  return (
    typeof value === "object" &&
    value !== null &&
    "chat_id" in value &&
    typeof value.chat_id === "string" &&
    "text" in value &&
    typeof value.text === "string"
  )
}

interface FakeZaloServer {
  baseUrl: string
  requests: { path: string; body: SendBody }[]
  stop(): Promise<void>
}

function startFakeZaloServer(): FakeZaloServer {
  const requests: FakeZaloServer["requests"] = []
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const body: unknown = await request.json()
      if (!isSendBody(body)) return Response.json({ ok: false, description: "bad body" }, { status: 400 })
      requests.push({ path: new URL(request.url).pathname, body })
      return Response.json({ ok: true, result: { message_id: "out-1" } })
    },
  })
  return {
    baseUrl: `http://localhost:${server.port}`,
    requests,
    stop: () => server.stop(true),
  }
}

test("the Zalo adapter posts chat_id and text to the bot sendMessage endpoint", async () => {
  const server = startFakeZaloServer()
  try {
    await createZaloApi({ token: TOKEN, baseUrl: server.baseUrl }).sendText("zalo-chat-1", "hello from kanna")
  } finally {
    await server.stop()
  }

  expect(server.requests).toEqual([
    { path: `/bot${TOKEN}/sendMessage`, body: { chat_id: "zalo-chat-1", text: "hello from kanna" } },
  ])
})

test("a 4500-character reply reaches Zalo as ordered chunks of at most 2000 characters", async () => {
  const reply = Array.from({ length: 700 }, (_, index) => `word${String(index).padStart(4, "0")}`).join(" ")
  const kanna: KannaApi = {
    async sendMessage() {
      return {
        ok: true,
        value: {
          chatId: "kanna-chat-1",
          status: "idle",
          busy: false,
          done: true,
          assistantText: reply,
          cursor: 1,
          timedOut: false,
          duplicate: false,
          queued: false,
        },
      }
    },
    async waitForChat() {
      return { ok: false, error: "unexpected wait" }
    },
    async openProject() {
      return { ok: true, value: "project-1" }
    },
    async callTool() {
      return { ok: false, error: "unexpected tool call" }
    },
    async listPendingToolRequests() {
      return { ok: true, value: [] }
    },
    async answerToolRequest() {
      return { ok: false, error: "unexpected answer" }
    },
    async respondTool() {
      return { ok: false, error: "unexpected response" }
    },
  }
  const dir = await mkdtemp(join(tmpdir(), "zalo-kanna-bridge-"))
  const server = startFakeZaloServer()
  try {
    const bridge = createBridge({
      config: {
        webhookSecret: SECRET,
        webhookPath: "/zalo/webhook",
        superadminIds: new Set(["user-1"]),
        kannaDefaultDir: "/tmp/project-1",
        turnDeadlineSeconds: 1800,
      },
      kanna,
      zalo: createZaloApi({ token: TOKEN, baseUrl: server.baseUrl }),
      store: createFileStore(join(dir, "state.json")),
    })
    await bridge.fetch(
      new Request("http://bridge.test/zalo/webhook", {
        method: "POST",
        headers: { "X-Bot-Api-Secret-Token": SECRET },
        body: JSON.stringify({
          ok: true,
          result: {
            event_name: "message.text.received",
            message: {
              from: { id: "user-1", display_name: "Tester" },
              chat: { id: "zalo-chat-1", chat_type: "PRIVATE" },
              text: "write a lot",
              message_id: "m1",
              date: 1700000000,
            },
          },
        }),
      }),
    )
    await bridge.idle()
  } finally {
    await server.stop()
    await rm(dir, { recursive: true, force: true })
  }

  const chunks = server.requests.map((request) => request.body.text)
  expect(reply.length).toBeGreaterThan(4500)
  expect(chunks.length).toBeGreaterThan(2)
  expect(chunks.every((chunk) => chunk.length <= 2000)).toBe(true)
  expect(chunks.join("").replaceAll(/\s/g, "")).toBe(reply.replaceAll(/\s/g, ""))
})
