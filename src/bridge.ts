import { createAdminOps } from "./admin"
import { resolvePending, describePending, type Decision } from "./approvals"
import { ADMIN_COMMANDS, helpText, parseCommand, stripBotMention, type ParsedCommand } from "./commands"
import type { Config } from "./config"
import { extractDirectives, runDirective, type ParsedDirective } from "./directives"
import { errorMessage, isJsonObject, parseJson } from "./json"
import type { KannaApi, KannaResult } from "./kanna"
import { consoleLogger, type Logger } from "./log"
import { MESSAGES, type Messages } from "./messages"
import { adminPreamble, userPreamble } from "./preamble"
import { resolveSender } from "./roles"
import type { BridgeStore } from "./state"
import { SECRET_HEADER, TEXT_EVENT, isKnownEvent, parseUpdate, verifySecret, type ZaloApi, type ZaloMessage, type ZaloUpdate } from "./zalo"

export type { Logger } from "./log"

export type BridgeConfig = Pick<
  Config,
  | "webhookSecret"
  | "webhookPath"
  | "superadminIds"
  | "kannaDefaultDir"
  | "userDirRoot"
  | "turnDeadlineSeconds"
  | "progressPollSeconds"
  | "progressUpdateSeconds"
  | "progressTypingSeconds"
  | "progressAck"
> & { botDisplayName?: string | undefined }

export interface Scheduler {
  every(intervalMs: number, task: () => void): () => void
}

export const realScheduler: Scheduler = {
  every(intervalMs, task) {
    const handle = setInterval(task, intervalMs)
    return () => clearInterval(handle)
  },
}

export interface BridgeDeps {
  config: BridgeConfig
  kanna: KannaApi
  zalo: ZaloApi
  store: BridgeStore
  messages?: Messages
  log?: Logger
  now?: () => number
  scheduler?: Scheduler
}

export interface Bridge {
  fetch(request: Request): Promise<Response>
  idle(): Promise<void>
}

const SEEN_MESSAGE_LIMIT = 1000
const STATUS_TOOL_LIMIT = 5
const NO_ACCESS_REPLY_INTERVAL_MS = 24 * 60 * 60 * 1000
const KNOWN_USERS_IN_PREAMBLE = 20
const MCP_REPLY_LIMIT = 6000

type Role = "superadmin" | "user"
type ChatKind = "PRIVATE" | "GROUP" | "unknown"

function chatKind(chatType: string | undefined): ChatKind {
  const upper = chatType?.toUpperCase()
  return upper === "PRIVATE" || upper === "GROUP" ? upper : "unknown"
}

interface Participant {
  role: Role
  fromId: string
  name: string
  chatId: string
  chatType: ChatKind
  convKey: string
}

interface WaitingConversation extends Participant {
  kannaChatId: string
  cursor: number | undefined
}

type FollowStart = Pick<KannaResult, "chatId" | "status" | "done" | "assistantText" | "activity"> & { cursor?: number }

type Turn =
  | {
      kind: "reply"
      text: string
      directives: ParsedDirective[]
      waiting?: { kannaChatId: string; cursor: number | undefined }
    }
  | { kind: "kanna_error"; error: string }

interface TurnProgress {
  lastSentAt: number
  answeredInPieces: boolean
  tools: string[]
}

function isSettled(call: Pick<KannaResult, "done" | "status">): boolean {
  return call.done || call.status === "waiting_for_user"
}

function toolLabel(toolName: string): string {
  if (!toolName.startsWith("mcp__")) return toolName
  const rest = toolName.slice("mcp__".length)
  const separator = rest.indexOf("__")
  const tool = separator === -1 ? "" : rest.slice(separator + 2)
  return tool === "" ? toolName : tool
}

function joinParagraphs(parts: readonly string[]): string {
  return parts
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .join("\n\n")
}

function conversationKey(chatId: string, fromId: string): string {
  return `${chatId}:${fromId}`
}

export function createBridge(deps: BridgeDeps): Bridge {
  const { config, kanna, zalo, store } = deps
  const log = deps.log ?? consoleLogger
  const now = deps.now ?? Date.now
  const messages = deps.messages ?? MESSAGES
  const scheduler = deps.scheduler ?? realScheduler
  const admin = createAdminOps({ config, kanna, messages, store, now })

  const pending = new Set<Promise<void>>()
  const tails = new Map<string, Promise<void>>()
  const seenMessageIds = new Set<string>()
  const waiting = new Map<string, WaitingConversation>()

  function rememberMessage(messageId: string): boolean {
    if (seenMessageIds.has(messageId)) return false
    seenMessageIds.add(messageId)
    if (seenMessageIds.size > SEEN_MESSAGE_LIMIT) {
      const oldest = seenMessageIds.values().next()
      if (!oldest.done) seenMessageIds.delete(oldest.value)
    }
    return true
  }

  function enqueue(key: string, task: () => Promise<void>): void {
    const previous = tails.get(key) ?? Promise.resolve()
    const run = previous.then(task).catch((error) => {
      log.error(`unexpected error while handling a Zalo message: ${errorMessage(error)}`)
    })
    tails.set(key, run)
    pending.add(run)
    void run.finally(() => {
      pending.delete(run)
      if (tails.get(key) === run) tails.delete(key)
    })
  }

  async function say(zaloChatId: string, text: string): Promise<void> {
    try {
      await zalo.sendText(zaloChatId, text)
    } catch (error) {
      log.error(`failed to send Zalo reply: ${errorMessage(error)}`)
    }
  }

  async function remember(what: string, write: Promise<void>): Promise<void> {
    try {
      await write
    } catch (error) {
      log.error(`failed to persist ${what}: ${errorMessage(error)}`)
    }
  }

  async function typing(zaloChatId: string): Promise<void> {
    try {
      await zalo.sendTyping(zaloChatId)
    } catch (error) {
      log.error(`failed to send the Zalo typing indicator: ${errorMessage(error)}`)
    }
  }

  async function sayDuringTurn(who: Participant, progress: TurnProgress, text: string): Promise<void> {
    await say(who.chatId, text)
    progress.lastSentAt = now()
  }

  function collectTools(progress: TurnProgress, activity: KannaResult["activity"]): void {
    for (const entry of activity) {
      if (entry.toolName === undefined || entry.toolName === "") continue
      const label = toolLabel(entry.toolName)
      if (progress.tools.length < STATUS_TOOL_LIMIT && !progress.tools.includes(label)) progress.tools.push(label)
    }
  }

  async function followTurn(who: Participant, first: FollowStart, progress: TurnProgress): Promise<Turn> {
    const held: string[] = []
    const directives: ParsedDirective[] = []
    const updateAfterMs = config.progressUpdateSeconds * 1000

    async function absorb(call: FollowStart): Promise<void> {
      const extracted = extractDirectives(call.assistantText)
      directives.push(...extracted.directives)
      if (isSettled(call)) {
        held.push(extracted.text)
        return
      }
      if (extracted.text !== "") {
        progress.answeredInPieces = true
        await sayDuringTurn(who, progress, extracted.text)
        return
      }
      collectTools(progress, call.activity)
      if (now() - progress.lastSentAt >= updateAfterMs) {
        await sayDuringTurn(who, progress, messages.stillWorking(progress.tools))
        progress.tools = []
      }
    }

    let latest = first
    await absorb(first)
    const deadline = now() + config.turnDeadlineSeconds * 1000
    while (!isSettled(latest)) {
      if (now() >= deadline) {
        return { kind: "reply", text: joinParagraphs([...held, messages.deadlineReached]), directives }
      }
      const waited = await kanna.waitForChat({
        chatId: first.chatId,
        ...(latest.cursor === undefined ? {} : { cursor: latest.cursor }),
        timeoutSeconds: config.progressPollSeconds,
      })
      if (!waited.ok) return { kind: "kanna_error", error: waited.error }
      latest = waited.value
      await absorb(latest)
    }
    if (latest.status === "waiting_for_user") {
      return {
        kind: "reply",
        text: joinParagraphs(held),
        directives,
        waiting: { kannaChatId: first.chatId, cursor: latest.cursor },
      }
    }
    if (latest.status === "failed") {
      return { kind: "reply", text: joinParagraphs([...held, messages.turnFailed]), directives }
    }
    return { kind: "reply", text: joinParagraphs(held), directives }
  }

  async function runTurn(who: Participant, messageId: string, text: string, progress: TurnProgress): Promise<Turn> {
    const workspace = await admin.workspaceFor(who.role, who.fromId)
    if (!workspace.ok) return { kind: "kanna_error", error: workspace.error }
    const { dir, projectId } = workspace.value
    const content =
      who.role === "user"
        ? userPreamble(who.name, dir, text)
        : adminPreamble(who.name, admin.knownUsers(KNOWN_USERS_IN_PREAMBLE), text)
    const base = { content, idempotencyKey: `zalo:${messageId}`, timeoutSeconds: config.progressPollSeconds }
    const openInProject = () => kanna.sendMessage({ ...base, projectId })

    const stored = store.getConversation(who.convKey)
    const mapped = stored?.projectId === projectId ? stored.kannaChatId : undefined
    let sent = mapped === undefined ? await openInProject() : await kanna.sendMessage({ ...base, chatId: mapped })
    if (mapped !== undefined && !sent.ok && /not found/i.test(sent.error)) {
      sent = await openInProject()
    }
    if (!sent.ok) return { kind: "kanna_error", error: sent.error }

    if (sent.value.chatId !== mapped) {
      await remember("conversation mapping", store.setConversation(who.convKey, { kannaChatId: sent.value.chatId, projectId }))
    }
    return followTurn(who, sent.value, progress)
  }

  async function notifyAdmins(who: Participant, details: string): Promise<void> {
    const text = joinParagraphs([
      messages.waitingUserNotice(who.name, who.fromId),
      details,
      messages.adminReplyHint(who.fromId),
    ])
    let notified = 0
    for (const adminId of config.superadminIds) {
      const chatId = store.getAdmin(adminId).chatId
      if (chatId === undefined) continue
      await say(chatId, text)
      notified += 1
    }
    if (notified === 0) log.info(`no admin could be notified that ${who.name} (${who.fromId}) is waiting for approval`)
  }

  async function waitingNotice(who: Participant, wait: { kannaChatId: string; cursor: number | undefined }): Promise<string> {
    let details = ""
    try {
      const listed = await kanna.listPendingToolRequests(wait.kannaChatId)
      if (listed.ok) details = describePending(messages, listed.value)
      else log.error(`could not list pending Kanna requests: ${listed.error}`)
    } catch (error) {
      log.error(`could not list pending Kanna requests: ${errorMessage(error)}`)
    }
    waiting.set(who.convKey, { ...who, kannaChatId: wait.kannaChatId, cursor: wait.cursor })
    if (who.role === "superadmin") return joinParagraphs([details || messages.waitingGeneric, messages.waitingForYou])
    await notifyAdmins(who, details)
    return messages.waitingForAdmin
  }

  async function applyDirectives(who: Participant, text: string, directives: readonly ParsedDirective[]): Promise<string> {
    if (directives.length === 0) return text
    if (who.role !== "superadmin") {
      log.info(`ignored ${directives.length} bridge action line(s) in a turn for user ${who.fromId}`)
      return text
    }
    const results: string[] = []
    for (const directive of directives) {
      try {
        results.push((await runDirective(admin, messages, who.fromId, directive)).text)
      } catch (error) {
        log.error(`bridge action failed: ${errorMessage(error)}`)
        results.push(messages.unreachable)
      }
    }
    return joinParagraphs([text, results.join("\n")])
  }

  async function deliver(who: Participant, turn: Turn, progress: TurnProgress): Promise<void> {
    if (turn.kind === "kanna_error") {
      log.error(`Kanna returned an error: ${turn.error}`)
      await say(who.chatId, messages.kannaError)
      return
    }
    let text = await applyDirectives(who, turn.text, turn.directives)
    if (turn.waiting === undefined) {
      waiting.delete(who.convKey)
    } else {
      text = joinParagraphs([text, await waitingNotice(who, turn.waiting)])
    }
    if (text === "" && progress.answeredInPieces) return
    await say(who.chatId, text || messages.emptyReply)
  }

  async function followWithTyping(
    who: Participant,
    options: { ack: boolean },
    progress: TurnProgress,
    start: () => Promise<Turn>,
  ): Promise<Turn> {
    await typing(who.chatId)
    if (options.ack && config.progressAck) await sayDuringTurn(who, progress, messages.received)
    const stopTyping = scheduler.every(config.progressTypingSeconds * 1000, () => void typing(who.chatId))
    try {
      return await start()
    } finally {
      stopTyping()
    }
  }

  async function followAndDeliver(
    who: Participant,
    options: { ack: boolean },
    start: (progress: TurnProgress) => Promise<Turn>,
  ): Promise<void> {
    const progress: TurnProgress = { lastSentAt: now(), answeredInPieces: false, tools: [] }
    let turn: Turn
    try {
      turn = await followWithTyping(who, options, progress, () => start(progress))
    } catch (error) {
      log.error(`Kanna call failed: ${errorMessage(error)}`)
      await say(who.chatId, messages.unreachable)
      return
    }
    await deliver(who, turn, progress)
  }

  function resumeAfterDecision(target: WaitingConversation): void {
    waiting.delete(target.convKey)
    enqueue(target.convKey, () =>
      followAndDeliver(target, { ack: false }, (progress) =>
        followTurn(
          target,
          {
            chatId: target.kannaChatId,
            status: "running",
            done: false,
            assistantText: "",
            activity: [],
            ...(target.cursor === undefined ? {} : { cursor: target.cursor }),
          },
          progress,
        ),
      ),
    )
  }

  async function decide(who: Participant, name: "approve" | "deny" | "answer", rest: string): Promise<string> {
    const [first = ""] = rest.split(/\s+/)
    const named = first === "" ? undefined : [...waiting.values()].find((w) => w.role === "user" && w.fromId === first)
    const remaining = named === undefined ? rest : rest.slice(first.length).trim()
    let target = named ?? waiting.get(who.convKey)
    if (target === undefined) {
      const stored = store.getConversation(who.convKey)
      if (stored === undefined) return messages.nothingWaiting
      target = { ...who, kannaChatId: stored.kannaChatId, cursor: undefined }
    }
    let decision: Decision
    if (name === "approve") {
      if (remaining !== "") return messages.usageApprove(first)
      decision = { type: "approve" }
    } else if (name === "deny") {
      decision = remaining === "" ? { type: "deny" } : { type: "deny", reason: remaining }
    } else {
      if (remaining === "") return messages.usageAnswer
      decision = { type: "answer", text: remaining }
    }
    const resolved = await resolvePending(kanna, messages, target.kannaChatId, decision)
    if (!resolved.ok) return resolved.error
    resumeAfterDecision(target)
    return messages.waitingForReply(resolved.value)
  }

  async function runMcp(rest: string): Promise<string> {
    const [tool = ""] = rest.split(/\s+/)
    const rawArgs = rest.slice(tool.length).trim()
    const usage = messages.usageMcp
    if (tool === "") return usage
    let args = {}
    if (rawArgs !== "") {
      const parsed = parseJson(rawArgs)
      if (parsed === undefined || !isJsonObject(parsed)) return messages.mcpArgumentsNotObject(usage)
      args = parsed
    }
    const called = await kanna.callTool(tool, args)
    const text = called.ok ? called.value : messages.mcpError(called.error)
    return text.length > MCP_REPLY_LIMIT ? `${text.slice(0, MCP_REPLY_LIMIT)}\n${messages.mcpTruncated}` : text
  }

  async function runCommand(who: Participant, command: ParsedCommand): Promise<string> {
    if (ADMIN_COMMANDS.has(command.name) && who.role !== "superadmin") return messages.adminOnly
    switch (command.name) {
      case "help":
        return helpText(messages, who.role)
      case "whoami": {
        const dir =
          who.role === "superadmin"
            ? admin.currentDir(who.fromId)
            : (store.getUser(who.fromId)?.dir ?? messages.noDirectory)
        return messages.whoami(who.role, who.fromId, dir)
      }
      case "new":
        await store.deleteConversation(who.convKey)
        waiting.delete(who.convKey)
        return messages.newConversation
      case "dir":
        if (command.rest === "") return messages.currentDir(admin.currentDir(who.fromId))
        return (await admin.setDir(who.fromId, command.rest)).text
      case "assign": {
        const [userId = ""] = command.rest.split(/\s+/)
        const dir = command.rest.slice(userId.length).trim()
        if (userId === "" || dir === "") return messages.usageAssign
        return (await admin.assign(who.fromId, userId, dir)).text
      }
      case "unassign":
        return command.rest === "" ? messages.usageUnassign : (await admin.unassign(command.rest)).text
      case "users":
        return admin.describeUsers()
      case "approve":
      case "deny":
      case "answer":
        return decide(who, command.name, command.rest)
      case "mcp":
        return runMcp(command.rest)
      default:
        return helpText(messages, who.role)
    }
  }

  async function handleKnownText(who: Participant, messageId: string, rawText: string): Promise<void> {
    const stripped = stripBotMention(rawText, config.botDisplayName)
    const text = stripped === "" ? "/help" : stripped
    const command = parseCommand(text)
    log.info(
      `message from ${who.fromId} (${who.name}) role=${who.role} chat=${who.chatType} ` +
        `kind=${command === undefined ? "text" : `/${command.name}`}`,
    )
    if (command !== undefined) {
      let reply: string
      try {
        reply = await runCommand(who, command)
      } catch (error) {
        log.error(`command /${command.name} failed: ${errorMessage(error)}`)
        reply = messages.unreachable
      }
      await say(who.chatId, reply)
      return
    }
    await followAndDeliver(who, { ack: true }, (progress) => runTurn(who, messageId, text, progress))
  }

  async function handleUnknown(message: ZaloMessage): Promise<void> {
    log.info(`ignored message from unlisted user id ${message.fromId} (${message.displayName})`)
    const previous = store.getSeen(message.fromId)
    const t = now()
    const shouldReply = previous?.lastReplied === undefined || t - previous.lastReplied >= NO_ACCESS_REPLY_INTERVAL_MS
    const lastReplied = shouldReply ? t : previous?.lastReplied
    await remember(
      "seen sender",
      store.setSeen(message.fromId, {
        name: message.displayName,
        lastSeen: t,
        ...(lastReplied === undefined ? {} : { lastReplied }),
      }),
    )
    if (shouldReply) {
      log.info(
        `message from ${message.fromId} (${message.displayName}) role=unknown chat=${chatKind(message.chatType)} kind=text`,
      )
      await say(message.chatId, messages.noAccess(message.fromId))
    }
  }

  async function handleMessage(update: ZaloUpdate): Promise<void> {
    const { message, eventName } = update
    const sender = resolveSender(config.superadminIds, store, message.fromId)
    if (sender.role === "unknown") {
      await handleUnknown(message)
      return
    }
    const who: Participant = {
      role: sender.role,
      fromId: message.fromId,
      name: message.displayName,
      chatId: message.chatId,
      chatType: chatKind(message.chatType),
      convKey: conversationKey(message.chatId, message.fromId),
    }
    if (sender.role === "superadmin" && who.chatType === "PRIVATE") {
      await remember("admin chat", store.updateAdmin(message.fromId, { chatId: message.chatId }))
    }
    if (eventName !== TEXT_EVENT) {
      await say(message.chatId, messages.textOnly)
      return
    }
    if (message.text === undefined) return
    await handleKnownText(who, message.messageId, message.text)
  }

  function handleUpdate(update: ZaloUpdate): void {
    const { message, eventName } = update
    if (!isKnownEvent(eventName)) {
      log.info(`ignored webhook with unknown event ${eventName}`)
      return
    }
    if (!rememberMessage(message.messageId)) return
    enqueue(conversationKey(message.chatId, message.fromId), () => handleMessage(update))
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
      const presentedSecret = request.headers.get(SECRET_HEADER)
      if (!verifySecret(presentedSecret, config.webhookSecret)) {
        const reason = presentedSecret === null ? "missing" : `wrong (length ${presentedSecret.length})`
        const agent = request.headers.get("user-agent") ?? "none"
        log.info(`rejected webhook: ${SECRET_HEADER} ${reason}; user-agent ${agent}`)
        return new Response("forbidden", { status: 403 })
      }
      const body = parseJson(await request.text())
      if (body === undefined) return new Response("invalid JSON", { status: 400 })
      try {
        const update = parseUpdate(body)
        if (update === undefined) {
          const keys = isJsonObject(body) ? Object.keys(body).join(", ") : typeof body
          log.info(`ignored webhook body with an unrecognized shape; top-level keys: ${keys}`)
        } else {
          handleUpdate(update)
        }
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
