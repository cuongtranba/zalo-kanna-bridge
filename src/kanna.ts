import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import {
  booleanField,
  isJsonObject,
  numberField,
  parseJson,
  stringField,
  type JsonObject,
  type JsonValue,
} from "./json"

export type ChatStatus = "idle" | "starting" | "running" | "waiting_for_user" | "failed" | null

export interface KannaResult {
  chatId: string
  status: ChatStatus
  busy: boolean
  done: boolean
  assistantText: string
  cursor: number
  timedOut: boolean
  duplicate: boolean
  queued: boolean
}

export type KannaCallResult = { ok: true; value: KannaResult } | { ok: false; error: string }

export interface SendMessageArgs {
  chatId?: string
  projectId?: string
  content: string
  idempotencyKey: string
  timeoutSeconds: number
}

export interface WaitForChatArgs {
  chatId: string
  cursor: number
  timeoutSeconds: number
}

export interface KannaApi {
  sendMessage(args: SendMessageArgs): Promise<KannaCallResult>
  waitForChat(args: WaitForChatArgs): Promise<KannaCallResult>
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
    cursor,
    timedOut: booleanField(value, "timedOut") ?? false,
    duplicate: booleanField(value, "duplicate") ?? false,
    queued: booleanField(value, "queued") ?? false,
  }
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

  async function call(name: string, args: JsonObject, timeoutSeconds: number): Promise<KannaCallResult> {
    connecting ??= connect()
    const attempt = connecting
    try {
      const client = await attempt
      const result = await client.callTool({ name, arguments: args }, undefined, {
        timeout: timeoutSeconds * 1000 + REQUEST_TIMEOUT_SLACK_MS,
      })
      const output = readToolOutput(result)
      if (output.isError) return { ok: false, error: output.text }
      const parsed = parseJson(output.text)
      const value = parsed === undefined ? undefined : parseKannaResult(parsed)
      if (value === undefined) throw new Error(`Kanna ${name} returned an unexpected result`)
      return { ok: true, value }
    } catch (error) {
      discard(attempt)
      throw error
    }
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
      return call(
        "wait_for_chat",
        { chatId: args.chatId, cursor: args.cursor, timeoutSeconds: args.timeoutSeconds },
        args.timeoutSeconds,
      )
    },
  }
}
