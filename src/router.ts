import { basename } from "node:path"
import { errorMessage, isJsonObject, parseJson, stringField } from "./json"
import type { KannaApi, KannaProject, KannaResult } from "./kanna"
import type { Logger } from "./log"

export interface RouterConfig {
  routerModel: string
  routerTimeoutSeconds: number
}

export interface RouterDeps {
  kanna: KannaApi
  config: RouterConfig
  log: Logger
  now: () => number
}

export interface Fallback {
  projectId: string
  dir: string
}

export interface RouteDecision {
  project: KannaProject
  routed: boolean
}

export interface ProjectOverride {
  project: KannaProject
  text: string
}

export interface Router {
  route(messageId: string, text: string, fallback: Fallback): Promise<RouteDecision>
  override(text: string): Promise<ProjectOverride | undefined>
}

const PROJECT_LINE_LIMIT = 200
const MESSAGE_CHARACTER_LIMIT = 4000
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]+/g
const FIRST_JSON_OBJECT = /\{[^{}]*\}/

const ROUTING_INSTRUCTIONS =
  "Pick the single project this message is about. " +
  'Reply with exactly one line of JSON and nothing else: {"projectId":"<id from the list>"} ' +
  'or {"projectId":null} if no project clearly fits. Do not use any tools.'

function plain(text: string): string {
  return text.replace(CONTROL_CHARACTERS, " ").trim()
}

function routingPrompt(projects: readonly KannaProject[], text: string): string {
  const lines = projects.map((p) => `- ${plain(p.projectId)} | ${plain(p.title)} | ${plain(p.localPath)}`)
  return [
    "[Zalo bridge] You route messages to Kanna projects.",
    ROUTING_INSTRUCTIONS,
    `Projects (id | title | path):\n${lines.join("\n")}`,
    `Message:\n${text.slice(0, MESSAGE_CHARACTER_LIMIT)}`,
  ].join("\n\n")
}

type Pick = { kind: "project"; projectId: string } | { kind: "none"; reason: string }

function pickProject(reply: string, projects: readonly KannaProject[]): Pick {
  const match = FIRST_JSON_OBJECT.exec(reply)
  const parsed = match === null ? undefined : parseJson(match[0])
  if (parsed === undefined || !isJsonObject(parsed)) return { kind: "none", reason: "the reply was not JSON" }
  if (parsed["projectId"] === null) return { kind: "none", reason: "no project clearly fits" }
  const projectId = stringField(parsed, "projectId")
  if (projectId === undefined) return { kind: "none", reason: "the reply had no projectId" }
  if (!projects.some((p) => p.projectId === projectId)) return { kind: "none", reason: "the reply named an unknown project" }
  return { kind: "project", projectId }
}

export function createRouter(deps: RouterDeps): Router {
  const { kanna, config, log, now } = deps

  async function ask(messageId: string, prompt: string, projectId: string): Promise<{ chatId: string; reply: string } | string> {
    const deadline = now() + config.routerTimeoutSeconds * 1000
    const sent = await kanna.sendMessage({
      projectId,
      content: prompt,
      idempotencyKey: `zalo-route:${messageId}`,
      timeoutSeconds: config.routerTimeoutSeconds,
      model: config.routerModel,
      wait: true,
    })
    if (!sent.ok) return `Kanna refused the routing request: ${sent.error}`
    let latest: KannaResult = sent.value
    let reply = latest.assistantText
    while (!latest.done && latest.status !== "waiting_for_user" && latest.status !== "failed" && now() < deadline) {
      const remainingSeconds = Math.max(1, Math.ceil((deadline - now()) / 1000))
      const waited = await kanna.waitForChat({ chatId: latest.chatId, cursor: latest.cursor, timeoutSeconds: remainingSeconds })
      if (!waited.ok) break
      latest = waited.value
      reply += latest.assistantText
    }
    return { chatId: latest.chatId, reply: latest.done ? reply : "" }
  }

  async function archive(chatId: string): Promise<void> {
    try {
      const archived = await kanna.archiveChat(chatId)
      if (!archived.ok) log.error(`could not archive router chat ${chatId}: ${archived.error}`)
    } catch (error) {
      log.error(`could not archive router chat ${chatId}: ${errorMessage(error)}`)
    }
  }

  function fallbackDecision(projects: readonly KannaProject[], fallback: Fallback, reason: string): RouteDecision {
    log.info(`router fell back to the default directory: ${reason}`)
    const known = projects.find((p) => p.projectId === fallback.projectId)
    return {
      project: known ?? { projectId: fallback.projectId, title: basename(fallback.dir), localPath: fallback.dir },
      routed: false,
    }
  }

  async function route(messageId: string, text: string, fallback: Fallback): Promise<RouteDecision> {
    let projects: KannaProject[] = []
    try {
      const listed = await kanna.listProjects()
      if (!listed.ok) return fallbackDecision(projects, fallback, `could not list projects: ${listed.error}`)
      projects = listed.value.slice(0, PROJECT_LINE_LIMIT)
      if (projects.length === 0) return fallbackDecision(projects, fallback, "Kanna has no projects")
      const asked = await ask(messageId, routingPrompt(projects, text), fallback.projectId)
      if (typeof asked === "string") return fallbackDecision(projects, fallback, asked)
      await archive(asked.chatId)
      if (asked.reply === "") return fallbackDecision(projects, fallback, "the router gave no answer in time")
      const picked = pickProject(asked.reply, projects)
      if (picked.kind === "none") return fallbackDecision(projects, fallback, picked.reason)
      const project = projects.find((p) => p.projectId === picked.projectId)
      if (project === undefined) return fallbackDecision(projects, fallback, "the chosen project vanished")
      log.info(`router chose project ${project.title}`)
      return { project, routed: true }
    } catch (error) {
      return fallbackDecision(projects, fallback, errorMessage(error))
    }
  }

  async function override(text: string): Promise<ProjectOverride | undefined> {
    if (!text.startsWith("#")) return undefined
    try {
      const listed = await kanna.listProjects()
      if (!listed.ok) {
        log.error(`could not list projects for a # override: ${listed.error}`)
        return undefined
      }
      const matches = listed.value
        .filter((p) => {
          if (p.title === "") return false
          const end = 1 + p.title.length
          const boundary = text.length === end || /\s/.test(text.charAt(end))
          return boundary && text.slice(1, end).toLowerCase() === p.title.toLowerCase()
        })
        .sort((a, b) => b.title.length - a.title.length)
      const project = matches[0]
      if (project === undefined) return undefined
      const rest = text.slice(1 + project.title.length).trim()
      if (rest === "") return undefined
      log.info(`# override chose project ${project.title}`)
      return { project, text: rest }
    } catch (error) {
      log.error(`could not apply a # override: ${errorMessage(error)}`)
      return undefined
    }
  }

  return { route, override }
}
