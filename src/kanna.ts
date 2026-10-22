import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import {
  arrayField,
  booleanField,
  isJsonObject,
  numberField,
  parseJson,
  stringField,
  type JsonObject,
  type JsonValue,
} from "./json"

export type ChatStatus = "idle" | "starting" | "running" | "waiting_for_user" | "failed" | null

export interface ActivityEntry {
  kind: string
  toolName?: string
}

export interface KannaResult {
  chatId: string
  status: ChatStatus
  busy: boolean
  done: boolean
  assistantText: string
  activity: ActivityEntry[]
  cursor: number
  timedOut: boolean
  duplicate: boolean
  queued: boolean
}

export type KannaOutcome<T> = { ok: true; value: T } | { ok: false; error: string }

export type KannaCallResult = KannaOutcome<KannaResult>

export type PendingRequest =
  | { kind: "tool_request"; id: string; tool: string; input: JsonValue }
  | { kind: "interactive_tool"; id: string; tool: string; input: JsonValue }

export interface ToolDecision {
  kind: "allow" | "deny" | "answer"
  reason?: string
}

export interface SendMessageArgs {
  chatId?: string
  projectId?: string
  content: string
  idempotencyKey: string
  timeoutSeconds: number
}

export interface WaitForChatArgs {
  chatId: string
  cursor?: number
  timeoutSeconds: number
}

export interface AnswerToolRequestArgs {
  chatId: string
  toolRequestId: string
  decision: ToolDecision
}

export interface RespondToolArgs {
  chatId: string
  toolUseId: string
  result: JsonValue
}

export interface KannaApi {
  sendMessage(args: SendMessageArgs): Promise<KannaCallResult>
  waitForChat(args: WaitForChatArgs): Promise<KannaCallResult>
  openProject(localPath: string): Promise<KannaOutcome<string>>
  callTool(name: string, args: JsonObject): Promise<KannaOutcome<string>>
  listPendingToolRequests(chatId: string): Promise<KannaOutcome<PendingRequest[]>>
  answerToolRequest(args: AnswerToolRequestArgs): Promise<KannaOutcome<string>>
  respondTool(args: RespondToolArgs): Promise<KannaOutcome<string>>
}

export interface KannaMcpOptions {
  url: string
  password: string
}

const REQUEST_TIMEOUT_SLACK_MS = 30_000

function parseStatus(value: JsonValue | undefined): ChatStatus | undefined {
  if (value === null) return null
  switch (value) {
    case "idle":
    case "starting":
    case "running":
    case "waiting_for_user":
    case "failed":
      return value
    default:
      return undefined
  }
}

function parseActivity(value: JsonObject): ActivityEntry[] {
  const entries: ActivityEntry[] = []
  for (const item of arrayField(value, "activity") ?? []) {
    if (!isJsonObject(item)) continue
    const toolName = stringField(item, "toolName")
    entries.push({ kind: stringField(item, "kind") ?? "", ...(toolName === undefined ? {} : { toolName }) })
  }
  return entries
}

export function parseKannaResult(value: JsonValue): KannaResult | undefined {
  if (!isJsonObject(value)) return undefined
  const chatId = stringField(value, "chatId")
  const assistantText = stringField(value, "assistantText")
  const cursor = numberField(value, "cursor")
  const done = booleanField(value, "done")
  const status = parseStatus(value["status"])
  if (chatId === undefined || assistantText === undefined || cursor === undefined) return undefined
  if (done === undefined || status === undefined) return undefined
  return {
    chatId,
    status,
    busy: booleanField(value, "busy") ?? false,
    done,
    assistantText,
    activity: parseActivity(value),
    cursor,
    timedOut: booleanField(value, "timedOut") ?? false,
    duplicate: booleanField(value, "duplicate") ?? false,
    queued: booleanField(value, "queued") ?? false,
  }
}

function parsePendingRequest(value: JsonValue): PendingRequest | undefined {
  if (!isJsonObject(value)) return undefined
  const tool = stringField(value, "tool")
  const input = value["input"] ?? null
  if (tool === undefined) return undefined
  const kind = stringField(value, "kind")
  if (kind === "tool_request") {
    const id = stringField(value, "toolRequestId")
    return id === undefined ? undefined : { kind, id, tool, input }
  }
  if (kind === "interactive_tool") {
    const id = stringField(value, "toolUseId")
    return id === undefined ? undefined : { kind, id, tool, input }
  }
  return undefined
}

export function parsePendingRequests(value: JsonValue): PendingRequest[] | undefined {
  if (!isJsonObject(value)) return undefined
  const pending = arrayField(value, "pending")
  if (pending === undefined) return undefined
  const requests: PendingRequest[] = []
  for (const item of pending) {
    const request = parsePendingRequest(item)
    if (request !== undefined) requests.push(request)
  }
  return requests
}

interface ToolOutput {
  text: string
  isError: boolean
}

function readToolOutput(result: object): ToolOutput {
  const isError = "isError" in result && result.isError === true
  if (!("content" in result) || !Array.isArray(result.content)) {
    throw new Error("Kanna MCP result has no content")
  }
  const items: unknown[] = result.content
  for (const item of items) {
    if (
      typeof item === "object" &&
      item !== null &&
      "type" in item &&
      item.type === "text" &&
      "text" in item &&
      typeof item.text === "string"
    ) {
      return { text: item.text, isError }
    }
  }
  throw new Error("Kanna MCP result has no text content")
}

export function createKannaMcpApi(options: KannaMcpOptions): KannaApi {
  let connecting: Promise<Client> | undefined

  function connect(): Promise<Client> {
    const client = new Client({ name: "zalo-kanna-bridge", version: "0.1.0" })
    const transport = new StreamableHTTPClientTransport(new URL(options.url), {
      requestInit: { headers: { Authorization: `Bearer ${options.password}` } },
    })
    return client.connect(transport).then(() => client)
  }

  function discard(stale: Promise<Client> | undefined): void {
    if (stale === undefined) return
    if (connecting === stale) connecting = undefined
    stale.then((client) => client.close()).catch(() => undefined)
  }

  async function callRaw(name: string, args: JsonObject, timeoutSeconds: number): Promise<ToolOutput> {
    connecting ??= connect()
    const attempt = connecting
    try {
      const client = await attempt
      const result = await client.callTool({ name, arguments: args }, undefined, {
        timeout: timeoutSeconds * 1000 + REQUEST_TIMEOUT_SLACK_MS,
      })
      return readToolOutput(result)
    } catch (error) {
      discard(attempt)
      throw error
    }
  }

  async function call(name: string, args: JsonObject, timeoutSeconds: number): Promise<KannaCallResult> {
    const output = await callRaw(name, args, timeoutSeconds)
    if (output.isError) return { ok: false, error: output.text }
    const parsed = parseJson(output.text)
    const value = parsed === undefined ? undefined : parseKannaResult(parsed)
    if (value === undefined) throw new Error(`Kanna ${name} returned an unexpected result`)
    return { ok: true, value }
  }

  async function callText(name: string, args: JsonObject): Promise<KannaOutcome<string>> {
    const output = await callRaw(name, args, 0)
    return output.isError ? { ok: false, error: output.text } : { ok: true, value: output.text }
  }

  return {
    sendMessage(args) {
      const body: JsonObject = {
        content: args.content,
        idempotencyKey: args.idempotencyKey,
        timeoutSeconds: args.timeoutSeconds,
      }
      if (args.chatId !== undefined) body["chatId"] = args.chatId
      if (args.projectId !== undefined) body["projectId"] = args.projectId
      return call("send_message", body, args.timeoutSeconds)
    },
    waitForChat(args) {
      const body: JsonObject = { chatId: args.chatId, timeoutSeconds: args.timeoutSeconds }
      if (args.cursor !== undefined) body["cursor"] = args.cursor
      return call("wait_for_chat", body, args.timeoutSeconds)
    },
    callTool: callText,
    async openProject(localPath) {
      const output = await callText("open_project", { localPath })
      if (!output.ok) return output
      const parsed = parseJson(output.value)
      const projectId = parsed !== undefined && isJsonObject(parsed) ? stringField(parsed, "projectId") : undefined
      if (projectId === undefined) throw new Error("Kanna open_project returned an unexpected result")
      return { ok: true, value: projectId }
    },
    async listPendingToolRequests(chatId) {
      const output = await callText("list_pending_tool_requests", { chatId })
      if (!output.ok) return output
      const parsed = parseJson(output.value)
      const requests = parsed === undefined ? undefined : parsePendingRequests(parsed)
      if (requests === undefined) throw new Error("Kanna list_pending_tool_requests returned an unexpected result")
      return { ok: true, value: requests }
    },
    answerToolRequest(args) {
      const decision: JsonObject = { kind: args.decision.kind }
      if (args.decision.reason !== undefined) decision["reason"] = args.decision.reason
      return callText("answer_tool_request", { chatId: args.chatId, toolRequestId: args.toolRequestId, decision })
    },
    respondTool(args) {
      return callText("respond_tool", { chatId: args.chatId, toolUseId: args.toolUseId, result: args.result })
    },
  }
}
