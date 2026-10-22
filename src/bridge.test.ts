import { afterEach, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  MESSAGES,
  createBridge,
  createFileChatMap,
  type Bridge,
  type KannaApi,
  type KannaCallResult,
  type KannaResult,
  type Logger,
  type SendMessageArgs,
  type WaitForChatArgs,
  type ZaloApi,
} from "./index"

const SECRET = "test-secret-123"
const PROJECT_ID = "project-1"
const ALLOWED_USER = "user-1"

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

function kannaResult(overrides: Partial<KannaResult>): KannaCallResult {
  return {
    ok: true,
    value: {
      chatId: "kanna-chat-1",
      status: "idle",
      busy: false,
      done: true,
      assistantText: "",
      cursor: 1,
      timedOut: false,
      duplicate: false,
      queued: false,
      ...overrides,
    },
  }
}

interface FakeKanna extends KannaApi {
  sends: SendMessageArgs[]
  waits: WaitForChatArgs[]
}

interface KannaScript {
  send?: (args: SendMessageArgs, openedChats: number) => KannaCallResult
  wait?: (args: WaitForChatArgs, waitIndex: number) => KannaCallResult
}

function createFakeKanna(script: KannaScript = {}): FakeKanna {
  let openedChats = 0
  const fake: FakeKanna = {
    sends: [],
    waits: [],
    async sendMessage(args) {
      fake.sends.push(args)
      if (args.projectId !== undefined) openedChats += 1
      if (script.send) return script.send(args, openedChats)
      return kannaResult({ chatId: args.chatId ?? `kanna-chat-${openedChats}`, assistantText: `echo: ${args.content}` })
    },
    async waitForChat(args) {
      fake.waits.push(args)
      if (script.wait) return script.wait(args, fake.waits.length - 1)
      return kannaResult({ chatId: args.chatId })
    },
  }
  return fake
}

interface FakeZalo extends ZaloApi {
  sent: { chatId: string; text: string }[]
}

function createFakeZalo(): FakeZalo {
  const fake: FakeZalo = {
    sent: [],
    async sendText(chatId, text) {
      fake.sent.push({ chatId, text })
    },
  }
  return fake
}

function createLogCapture(): Logger & { lines: string[] } {
  const lines: string[] = []
  return {
    lines,
    info: (message) => lines.push(message),
    error: (message) => lines.push(message),
  }
}

async function newStateFile(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "zalo-kanna-bridge-"))
  tempDirs.push(dir)
  return join(dir, "nested", "state.json")
}

function newBridge(kanna: KannaApi, zalo: ZaloApi, stateFile: string, log?: Logger): Bridge {
  return createBridge({
    config: {
      webhookSecret: SECRET,
      webhookPath: "/zalo/webhook",
      allowedUserIds: new Set([ALLOWED_USER]),
      kannaProjectId: PROJECT_ID,
      turnDeadlineSeconds: 1800,
    },
    kanna,
    zalo,
    chats: createFileChatMap(stateFile),
    log,
  })
}

function deliver(
  bridge: Bridge,
  update: { messageId: string; text?: string; event?: string; fromId?: string; displayName?: string; unwrapped?: boolean },
  secret: string | null = SECRET,
): Promise<Response> {
  const headers: Record<string, string> = { "Content-Type": "application/json" }
  if (secret !== null) headers["X-Bot-Api-Secret-Token"] = secret
  const result = {
    event_name: update.event ?? "message.text.received",
    message: {
      from: { id: update.fromId ?? ALLOWED_USER, display_name: update.displayName ?? "Tester" },
      chat: { id: "zalo-chat-1", chat_type: "PRIVATE" },
      text: update.text ?? "hello",
      message_id: update.messageId,
      date: 1700000000,
    },
  }
  const body = update.unwrapped ? result : { ok: true, result }
  return bridge.fetch(
    new Request("http://bridge.test/zalo/webhook", { method: "POST", headers, body: JSON.stringify(body) }),
  )
}

test("a wrong or missing webhook secret is rejected with 403 and nothing reaches Kanna", async () => {
  const kanna = createFakeKanna()
  const bridge = newBridge(kanna, createFakeZalo(), await newStateFile())

  const wrong = await deliver(bridge, { messageId: "m1" }, "not-the-secret")
  const missing = await deliver(bridge, { messageId: "m2" }, null)
  await bridge.idle()

  expect([wrong.status, missing.status]).toEqual([403, 403])
  expect(kanna.sends).toEqual([])
})

test("a text opens a Kanna chat in the project and the next one continues it, even after a restart", async () => {
  const stateFile = await newStateFile()
  const kanna = createFakeKanna()
  const zalo = createFakeZalo()
  const first = newBridge(kanna, zalo, stateFile)

  const response = await deliver(first, { messageId: "m1", text: "first question" })
  await first.idle()
  await deliver(first, { messageId: "m2", text: "second question" })
  await first.idle()

  const restarted = newBridge(kanna, zalo, stateFile)
  await deliver(restarted, { messageId: "m3", text: "third question" })
  await restarted.idle()

  expect(response.status).toBe(200)
  expect(kanna.sends.map((send) => [send.projectId, send.chatId])).toEqual([
    [PROJECT_ID, undefined],
    [undefined, "kanna-chat-1"],
    [undefined, "kanna-chat-1"],
  ])
  expect(zalo.sent.map((message) => message.text)).toEqual([
    "echo: first question",
    "echo: second question",
    "echo: third question",
  ])
})

test("an update posted without the { ok, result } wrapper is handled like a wrapped one", async () => {
  const kanna = createFakeKanna()
  const zalo = createFakeZalo()
  const bridge = newBridge(kanna, zalo, await newStateFile())

  await deliver(bridge, { messageId: "m1", text: "bare update", unwrapped: true })
  await bridge.idle()

  expect(zalo.sent).toEqual([{ chatId: "zalo-chat-1", text: "echo: bare update" }])
})

test("a message from a user outside the allowlist is ignored but its id is logged", async () => {
  const kanna = createFakeKanna()
  const zalo = createFakeZalo()
  const log = createLogCapture()
  const bridge = newBridge(kanna, zalo, await newStateFile(), log)

  await deliver(bridge, { messageId: "m1", fromId: "999", displayName: "Mallory" })
  await bridge.idle()

  expect(kanna.sends).toEqual([])
  expect(zalo.sent).toEqual([])
  expect(log.lines).toContain("ignored message from unlisted user id 999 (Mallory)")
})

test("the same message_id delivered twice is processed once", async () => {
  const kanna = createFakeKanna()
  const zalo = createFakeZalo()
  const bridge = newBridge(kanna, zalo, await newStateFile())

  await deliver(bridge, { messageId: "dup-1" })
  await deliver(bridge, { messageId: "dup-1" })
  await bridge.idle()

  expect(kanna.sends).toHaveLength(1)
  expect(kanna.sends[0]?.idempotencyKey).toBe("zalo:dup-1")
  expect(zalo.sent).toHaveLength(1)
})

test("an unfinished turn is followed with the returned cursor and all text is joined in order", async () => {
  const kanna = createFakeKanna({
    send: () => kannaResult({ done: false, status: "running", assistantText: "part one", cursor: 5 }),
    wait: (_args, index) =>
      index === 0
        ? kannaResult({ done: false, status: "running", assistantText: "part two", cursor: 9 })
        : kannaResult({ done: true, status: "idle", assistantText: "part three", cursor: 12 }),
  })
  const zalo = createFakeZalo()
  const bridge = newBridge(kanna, zalo, await newStateFile())

  await deliver(bridge, { messageId: "m1" })
  await bridge.idle()

  expect(kanna.waits.map((wait) => [wait.chatId, wait.cursor])).toEqual([
    ["kanna-chat-1", 5],
    ["kanna-chat-1", 9],
  ])
  expect(zalo.sent.map((message) => message.text)).toEqual(["part one\n\npart two\n\npart three"])
})

test("a turn waiting for a permission approval tells the user to open Kanna", async () => {
  const kanna = createFakeKanna({
    send: () => kannaResult({ done: false, status: "waiting_for_user", assistantText: "I need to run a command" }),
  })
  const zalo = createFakeZalo()
  const bridge = newBridge(kanna, zalo, await newStateFile())

  await deliver(bridge, { messageId: "m1" })
  await bridge.idle()

  expect(kanna.waits).toEqual([])
  expect(zalo.sent.map((message) => message.text)).toEqual([
    `I need to run a command\n\n${MESSAGES.waitingForApproval}`,
  ])
})

test("/new makes the next message open a fresh Kanna chat", async () => {
  const kanna = createFakeKanna()
  const zalo = createFakeZalo()
  const bridge = newBridge(kanna, zalo, await newStateFile())

  await deliver(bridge, { messageId: "m1", text: "before" })
  await bridge.idle()
  await deliver(bridge, { messageId: "m2", text: " /new " })
  await bridge.idle()
  await deliver(bridge, { messageId: "m3", text: "after" })
  await bridge.idle()

  expect(kanna.sends.map((send) => send.content)).toEqual(["before", "after"])
  expect(kanna.sends.map((send) => send.projectId)).toEqual([PROJECT_ID, PROJECT_ID])
  expect(zalo.sent.map((message) => message.text)).toContain(MESSAGES.newConversation)
})
