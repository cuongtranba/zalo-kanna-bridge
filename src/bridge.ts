import type { Config } from "./config"
import { errorMessage, parseJson } from "./json"
import type { KannaApi, KannaResult } from "./kanna"
import type { ChatMap } from "./state"
import { SECRET_HEADER, TEXT_EVENT, isKnownEvent, parseUpdate, verifySecret, type ZaloApi, type ZaloUpdate } from "./zalo"

export type BridgeConfig = Pick<
  Config,
  "webhookSecret" | "webhookPath" | "allowedUserIds" | "kannaProjectId" | "turnDeadlineSeconds"
>

export interface Logger {
  info(message: string): void
  error(message: string): void
}

export interface BridgeDeps {
  config: BridgeConfig
  kanna: KannaApi
  zalo: ZaloApi
  chats: ChatMap
  log?: Logger
  now?: () => number
}

export interface Bridge {
  fetch(request: Request): Promise<Response>
  idle(): Promise<void>
}

export const MESSAGES = {
  newConversation: "Started a new Kanna conversation.",
  emptyReply: "(Kanna finished without a text reply.)",
  waitingForApproval: "Kanna is waiting for a permission approval. Open Kanna to continue.",
  turnFailed: "The Kanna turn failed. Check the chat in Kanna.",
  stillWorking: "Kanna is still working on this. Check the chat in Kanna.",
  unreachable: "Could not reach Kanna right now.",
  kannaError: "Kanna returned an error. Check the chat in Kanna.",
  textOnly: "Only text messages are supported for now.",
} as const

const SEEN_MESSAGE_LIMIT = 1000
const POLL_TIMEOUT_SECONDS = 90

type Turn = { kind: "reply"; text: string } | { kind: "kanna_error"; error: string }

const consoleLogger: Logger = {
  info: (message) => console.log(message),
  error: (message) => console.error(message),
}

function joinParagraphs(parts: readonly string[]): string {
  return parts
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .join("\n\n")
}

export function createBridge(deps: BridgeDeps): Bridge {
  const { config, kanna, zalo, chats } = deps
  const log = deps.log ?? consoleLogger
  const now = deps.now ?? Date.now

  const pending = new Set<Promise<void>>()
  const tails = new Map<string, Promise<void>>()
  const seenMessageIds = new Set<string>()

  function rememberMessage(messageId: string): boolean {
    if (seenMessageIds.has(messageId)) return false
    seenMessageIds.add(messageId)
    if (seenMessageIds.size > SEEN_MESSAGE_LIMIT) {
      const oldest = seenMessageIds.values().next()
      if (!oldest.done) seenMessageIds.delete(oldest.value)
    }
    return true
  }

  function enqueue(zaloChatId: string, task: () => Promise<void>): void {
    const previous = tails.get(zaloChatId) ?? Promise.resolve()
    const run = previous.then(task).catch((error) => {
      log.error(`unexpected error while handling a Zalo message: ${errorMessage(error)}`)
    })
    tails.set(zaloChatId, run)
    pending.add(run)
    void run.finally(() => {
      pending.delete(run)
      if (tails.get(zaloChatId) === run) tails.delete(zaloChatId)
    })
  }

  async function say(zaloChatId: string, text: string): Promise<void> {
    try {
      await zalo.sendText(zaloChatId, text)
    } catch (error) {
      log.error(`failed to send Zalo reply: ${errorMessage(error)}`)
    }
  }

  async function followTurn(first: KannaResult): Promise<Turn> {
    const pieces: string[] = [first.assistantText]
    let latest = first
    const deadline = now() + config.turnDeadlineSeconds * 1000
    while (!latest.done && latest.status !== "waiting_for_user") {
      if (now() >= deadline) {
        return { kind: "reply", text: joinParagraphs([...pieces, MESSAGES.stillWorking]) }
      }
      const waited = await kanna.waitForChat({
        chatId: first.chatId,
        cursor: latest.cursor,
        timeoutSeconds: POLL_TIMEOUT_SECONDS,
      })
      if (!waited.ok) return { kind: "kanna_error", error: waited.error }
      latest = waited.value
      pieces.push(latest.assistantText)
    }
    if (latest.status === "waiting_for_user") {
      return { kind: "reply", text: joinParagraphs([...pieces, MESSAGES.waitingForApproval]) }
    }
    if (latest.status === "failed") {
      return { kind: "reply", text: joinParagraphs([...pieces, MESSAGES.turnFailed]) }
    }
    return { kind: "reply", text: joinParagraphs(pieces) || MESSAGES.emptyReply }
  }

  async function runTurn(zaloChatId: string, messageId: string, content: string): Promise<Turn> {
    const idempotencyKey = `zalo:${messageId}`
    const base = { content, idempotencyKey, timeoutSeconds: POLL_TIMEOUT_SECONDS }
    const openInProject = () => kanna.sendMessage({ ...base, projectId: config.kannaProjectId })

    const mapped = chats.get(zaloChatId)
    let sent = mapped === undefined ? await openInProject() : await kanna.sendMessage({ ...base, chatId: mapped })
    if (mapped !== undefined && !sent.ok && /not found/i.test(sent.error)) {
      await chats.delete(zaloChatId)
      sent = await openInProject()
    }
    if (!sent.ok) return { kind: "kanna_error", error: sent.error }

    if (sent.value.chatId !== mapped) {
      try {
        await chats.set(zaloChatId, sent.value.chatId)
      } catch (error) {
        log.error(`failed to persist chat mapping: ${errorMessage(error)}`)
      }
    }
    return followTurn(sent.value)
  }

  async function handleText(zaloChatId: string, messageId: string, text: string): Promise<void> {
    if (text.trim() === "/new") {
      await chats.delete(zaloChatId)
      await say(zaloChatId, MESSAGES.newConversation)
      return
    }
    let turn: Turn
    try {
      turn = await runTurn(zaloChatId, messageId, text)
    } catch (error) {
      log.error(`Kanna call failed: ${errorMessage(error)}`)
      await say(zaloChatId, MESSAGES.unreachable)
      return
    }
    if (turn.kind === "kanna_error") {
      log.error(`Kanna returned an error: ${turn.error}`)
      await say(zaloChatId, MESSAGES.kannaError)
      return
    }
    await say(zaloChatId, turn.text)
  }

  function handleUpdate(update: ZaloUpdate): void {
    const { message, eventName } = update
    if (!isKnownEvent(eventName)) return
    if (!config.allowedUserIds.has(message.fromId)) {
      log.info(`ignored message from unlisted user id ${message.fromId} (${message.displayName})`)
      return
    }
    if (!rememberMessage(message.messageId)) return
    if (eventName !== TEXT_EVENT) {
      enqueue(message.chatId, () => say(message.chatId, MESSAGES.textOnly))
      return
    }
    const text = message.text
    if (text === undefined) return
    enqueue(message.chatId, () => handleText(message.chatId, message.messageId, text))
  }

  return {
    async fetch(request) {
      const { pathname } = new URL(request.url)
      if (pathname === "/healthz" && (request.method === "GET" || request.method === "HEAD")) {
        return new Response("ok")
      }
      if (pathname !== config.webhookPath) return new Response("not found", { status: 404 })
      if (request.method !== "POST") {
        return new Response("method not allowed", { status: 405, headers: { Allow: "POST" } })
      }
      if (!verifySecret(request.headers.get(SECRET_HEADER), config.webhookSecret)) {
        return new Response("forbidden", { status: 403 })
      }
      const body = parseJson(await request.text())
      if (body === undefined) return new Response("invalid JSON", { status: 400 })
      try {
        const update = parseUpdate(body)
        if (update !== undefined) handleUpdate(update)
      } catch (error) {
        log.error(`failed to accept webhook update: ${errorMessage(error)}`)
      }
      return Response.json({ ok: true })
    },
    async idle() {
      while (pending.size > 0) {
        await Promise.allSettled([...pending])
      }
    },
  }
}
