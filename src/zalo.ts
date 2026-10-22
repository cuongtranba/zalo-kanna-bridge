import { createHash, timingSafeEqual } from "node:crypto"
import {
  errorMessage,
  isJsonObject,
  objectField,
  parseJson,
  stringField,
  type JsonObject,
  type JsonValue,
} from "./json"

export const ZALO_API_BASE_URL = "https://bot-api.zaloplatforms.com"
export const ZALO_MESSAGE_LIMIT = 2000
export const SECRET_HEADER = "X-Bot-Api-Secret-Token"

export interface ZaloApi {
  sendText(chatId: string, text: string): Promise<void>
}

export interface ZaloClientOptions {
  token: string
  baseUrl?: string
}

export interface ZaloMessage {
  fromId: string
  displayName: string
  chatId: string
  chatType: string | undefined
  messageId: string
  text: string | undefined
}

export interface ZaloUpdate {
  eventName: string
  message: ZaloMessage
}

export const TEXT_EVENT = "message.text.received"

const NON_TEXT_EVENTS: ReadonlySet<string> = new Set([
  "message.image.received",
  "message.sticker.received",
  "message.voice.received",
  "message.unsupported.received",
])

export function isKnownEvent(eventName: string): boolean {
  return eventName === TEXT_EVENT || NON_TEXT_EVENTS.has(eventName)
}

export function verifySecret(provided: string | null, expected: string): boolean {
  const digest = (value: string) => createHash("sha256").update(value).digest()
  return timingSafeEqual(digest(provided ?? ""), digest(expected))
}

function idField(object: JsonObject, key: string): string | undefined {
  const value = object[key]
  if (typeof value === "string" && value.length > 0) return value
  if (typeof value === "number") return String(value)
  return undefined
}

export function parseUpdate(body: JsonValue): ZaloUpdate | undefined {
  if (!isJsonObject(body)) return undefined
  const result = objectField(body, "result") ?? body
  const eventName = stringField(result, "event_name")
  const message = objectField(result, "message")
  if (eventName === undefined || message === undefined) return undefined
  const from = objectField(message, "from")
  const chat = objectField(message, "chat")
  if (from === undefined || chat === undefined) return undefined
  const fromId = idField(from, "id")
  const chatId = idField(chat, "id")
  const messageId = idField(message, "message_id")
  if (fromId === undefined || chatId === undefined || messageId === undefined) return undefined
  return {
    eventName,
    message: {
      fromId,
      displayName: stringField(from, "display_name") ?? "unknown",
      chatId,
      chatType: stringField(chat, "chat_type"),
      messageId,
      text: stringField(message, "text"),
    },
  }
}

function isSurrogatePairSplit(text: string, index: number): boolean {
  const before = text.charCodeAt(index - 1)
  const after = text.charCodeAt(index)
  return before >= 0xd800 && before <= 0xdbff && after >= 0xdc00 && after <= 0xdfff
}

export function chunkText(text: string, limit: number = ZALO_MESSAGE_LIMIT): string[] {
  const chunks: string[] = []
  let remaining = text.trim()
  while (remaining.length > limit) {
    const window = remaining.slice(0, limit + 1)
    let breakAt = window.lastIndexOf("\n")
    if (breakAt <= 0) breakAt = window.lastIndexOf(" ")
    let consumed: number
    if (breakAt > 0) {
      consumed = breakAt + 1
    } else {
      breakAt = isSurrogatePairSplit(remaining, limit) ? limit - 1 : limit
      consumed = breakAt
    }
    const chunk = remaining.slice(0, breakAt).trimEnd()
    if (chunk.length > 0) chunks.push(chunk)
    remaining = remaining.slice(consumed).trimStart()
  }
  if (remaining.length > 0) chunks.push(remaining)
  return chunks
}

export class ZaloRequestError extends Error {}

export async function zaloCall(
  options: ZaloClientOptions,
  method: string,
  body: JsonObject,
): Promise<JsonObject> {
  const baseUrl = (options.baseUrl ?? ZALO_API_BASE_URL).replace(/\/+$/, "")
  const redact = (text: string) => text.replaceAll(options.token, "<token>")
  let response: Response
  try {
    response = await fetch(`${baseUrl}/bot${options.token}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
  } catch (error) {
    throw new ZaloRequestError(`Zalo ${method} request failed: ${redact(errorMessage(error))}`)
  }
  const parsed = parseJson(await response.text())
  if (parsed === undefined || !isJsonObject(parsed)) {
    throw new ZaloRequestError(`Zalo ${method} returned a non-JSON response (HTTP ${response.status})`)
  }
  if (parsed["ok"] !== true) {
    const description = stringField(parsed, "description") ?? "no description"
    throw new ZaloRequestError(`Zalo ${method} failed (HTTP ${response.status}): ${redact(description)}`)
  }
  return parsed
}

export function createZaloApi(options: ZaloClientOptions): ZaloApi {
  return {
    async sendText(chatId, text) {
      for (const chunk of chunkText(text)) {
        await zaloCall(options, "sendMessage", { chat_id: chatId, text: chunk })
      }
    },
  }
}
