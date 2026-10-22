import { arrayField, isJsonObject, stringField, type JsonObject, type JsonValue } from "./json"
import type { KannaApi, KannaOutcome, PendingRequest } from "./kanna"
import type { Messages } from "./messages"

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

function describeQuestion(messages: Messages, question: JsonObject): string {
  const text = clip(stringField(question, "question") ?? messages.noQuestionText, SUMMARY_LIMIT)
  const options = (arrayField(question, "options") ?? []).filter(isJsonObject).map((option) => {
    const label = stringField(option, "label") ?? "?"
    const description = stringField(option, "description")
    return clip(description === undefined ? `  - ${label}` : `  - ${label}: ${description}`, OPTION_LIMIT)
  })
  return [messages.questionLabel(text), ...options].join("\n")
}

function describeOne(messages: Messages, request: PendingRequest): string {
  if (request.tool === "AskUserQuestion") {
    const questions = questionsOf(request.input)
    if (questions.length > 0) return questions.map((question) => describeQuestion(messages, question)).join("\n")
  }
  if (request.tool === "ExitPlanMode" && isJsonObject(request.input)) {
    return messages.planApprovalNeeded(clip(stringField(request.input, "plan") ?? messages.noPlanText, SUMMARY_LIMIT))
  }
  return messages.permissionNeeded(request.tool, clip(JSON.stringify(request.input), SUMMARY_LIMIT))
}

export function describePending(messages: Messages, requests: readonly PendingRequest[]): string {
  return requests.map((request) => describeOne(messages, request)).join("\n\n")
}

function wrongDecision(messages: Messages, request: PendingRequest, decision: Decision): string {
  if (request.tool === "AskUserQuestion") return messages.wrongQuestion
  if (request.tool === "ExitPlanMode") return messages.wrongPlan(decision.type)
  return messages.wrongPermission
}

async function resolveToolRequest(
  kanna: KannaApi,
  messages: Messages,
  chatId: string,
  request: PendingRequest,
  decision: Decision,
): Promise<KannaOutcome<string>> {
  if (decision.type === "answer") return { ok: false, error: wrongDecision(messages, request, decision) }
  const sent = await kanna.answerToolRequest({
    chatId,
    toolRequestId: request.id,
    decision:
      decision.type === "approve"
        ? { kind: "allow" }
        : { kind: "deny", ...(decision.reason === undefined ? {} : { reason: decision.reason }) },
  })
  if (!sent.ok) return sent
  return { ok: true, value: decision.type === "approve" ? messages.approvedTool(request.tool) : messages.deniedTool(request.tool) }
}

async function resolveInteractive(
  kanna: KannaApi,
  messages: Messages,
  chatId: string,
  request: PendingRequest,
  decision: Decision,
): Promise<KannaOutcome<string>> {
  if (request.tool === "AskUserQuestion" && decision.type === "answer") {
    const question = stringField(questionsOf(request.input)[0] ?? {}, "question")
    if (question === undefined) return { ok: false, error: messages.questionHasNoText }
    const sent = await kanna.respondTool({ chatId, toolUseId: request.id, result: { answers: { [question]: decision.text } } })
    return sent.ok ? { ok: true, value: messages.answeredQuestion } : sent
  }
  if (request.tool === "ExitPlanMode" && decision.type !== "answer") {
    const result: JsonObject =
      decision.type === "approve" ? { confirmed: true } : { confirmed: false, message: decision.reason ?? "Rejected" }
    const sent = await kanna.respondTool({ chatId, toolUseId: request.id, result })
    return sent.ok ? { ok: true, value: decision.type === "approve" ? messages.approvedPlan : messages.rejectedPlan } : sent
  }
  if (request.tool === "AskUserQuestion" || request.tool === "ExitPlanMode") {
    return { ok: false, error: wrongDecision(messages, request, decision) }
  }
  return { ok: false, error: messages.cannotAnswerHere(request.tool) }
}

export async function resolvePending(
  kanna: KannaApi,
  messages: Messages,
  chatId: string,
  decision: Decision,
): Promise<KannaOutcome<string>> {
  const listed = await kanna.listPendingToolRequests(chatId)
  if (!listed.ok) return listed
  const request = listed.value[0]
  if (request === undefined) return { ok: false, error: messages.nothingWaiting }
  return request.kind === "tool_request"
    ? resolveToolRequest(kanna, messages, chatId, request, decision)
    : resolveInteractive(kanna, messages, chatId, request, decision)
}
