import { arrayField, isJsonObject, stringField, type JsonObject, type JsonValue } from "./json"
import type { KannaApi, KannaOutcome, PendingRequest } from "./kanna"

export type Decision = { type: "approve" } | { type: "deny"; reason?: string } | { type: "answer"; text: string }

const SUMMARY_LIMIT = 300
const OPTION_LIMIT = 120

export function clip(text: string, limit: number): string {
  return text.length <= limit ? text : `${text.slice(0, limit - 1)}...`
}

function questionsOf(input: JsonValue): JsonObject[] {
  if (!isJsonObject(input)) return []
  return (arrayField(input, "questions") ?? []).filter(isJsonObject)
}

function describeQuestion(question: JsonObject): string {
  const text = clip(stringField(question, "question") ?? "(no question text)", SUMMARY_LIMIT)
  const options = (arrayField(question, "options") ?? []).filter(isJsonObject).map((option) => {
    const label = stringField(option, "label") ?? "?"
    const description = stringField(option, "description")
    return clip(description === undefined ? `  - ${label}` : `  - ${label}: ${description}`, OPTION_LIMIT)
  })
  return [`Question: ${text}`, ...options].join("\n")
}

function describeOne(request: PendingRequest): string {
  if (request.tool === "AskUserQuestion") {
    const questions = questionsOf(request.input)
    if (questions.length > 0) return questions.map(describeQuestion).join("\n")
  }
  if (request.tool === "ExitPlanMode" && isJsonObject(request.input)) {
    return `Plan approval needed:\n${clip(stringField(request.input, "plan") ?? "(no plan text)", SUMMARY_LIMIT)}`
  }
  return `Permission needed for ${request.tool}: ${clip(JSON.stringify(request.input), SUMMARY_LIMIT)}`
}

export function describePending(requests: readonly PendingRequest[]): string {
  return requests.map(describeOne).join("\n\n")
}

function wrongDecision(request: PendingRequest, decision: Decision): string {
  if (request.tool === "AskUserQuestion") return "That is a question. Reply with /answer <text>."
  if (request.tool === "ExitPlanMode") return `That is a plan. Reply with /approve or /deny <feedback> (not /${decision.type}).`
  return "That is a tool permission. Reply with /approve or /deny <reason>."
}

async function resolveToolRequest(
  kanna: KannaApi,
  chatId: string,
  request: PendingRequest,
  decision: Decision,
): Promise<KannaOutcome<string>> {
  if (decision.type === "answer") return { ok: false, error: wrongDecision(request, decision) }
  const sent = await kanna.answerToolRequest({
    chatId,
    toolRequestId: request.id,
    decision:
      decision.type === "approve"
        ? { kind: "allow" }
        : { kind: "deny", ...(decision.reason === undefined ? {} : { reason: decision.reason }) },
  })
  if (!sent.ok) return sent
  return { ok: true, value: `${decision.type === "approve" ? "Approved" : "Denied"} ${request.tool}.` }
}

async function resolveInteractive(
  kanna: KannaApi,
  chatId: string,
  request: PendingRequest,
  decision: Decision,
): Promise<KannaOutcome<string>> {
  if (request.tool === "AskUserQuestion" && decision.type === "answer") {
    const question = stringField(questionsOf(request.input)[0] ?? {}, "question")
    if (question === undefined) return { ok: false, error: "That question has no text to answer." }
    const sent = await kanna.respondTool({ chatId, toolUseId: request.id, result: { answers: { [question]: decision.text } } })
    return sent.ok ? { ok: true, value: "Answered the question." } : sent
  }
  if (request.tool === "ExitPlanMode" && decision.type !== "answer") {
    const result: JsonObject =
      decision.type === "approve" ? { confirmed: true } : { confirmed: false, message: decision.reason ?? "Rejected" }
    const sent = await kanna.respondTool({ chatId, toolUseId: request.id, result })
    return sent.ok ? { ok: true, value: decision.type === "approve" ? "Approved the plan." : "Rejected the plan." } : sent
  }
  if (request.tool === "AskUserQuestion" || request.tool === "ExitPlanMode") {
    return { ok: false, error: wrongDecision(request, decision) }
  }
  return { ok: false, error: `Cannot answer ${request.tool} from Zalo; answer it in Kanna.` }
}

export async function resolvePending(kanna: KannaApi, chatId: string, decision: Decision): Promise<KannaOutcome<string>> {
  const listed = await kanna.listPendingToolRequests(chatId)
  if (!listed.ok) return listed
  const request = listed.value[0]
  if (request === undefined) return { ok: false, error: "Nothing is waiting for approval." }
  return request.kind === "tool_request"
    ? resolveToolRequest(kanna, chatId, request, decision)
    : resolveInteractive(kanna, chatId, request, decision)
}
