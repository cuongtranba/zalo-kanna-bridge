import { LANGUAGES, type Language } from "./messages"
import { normalizeDir } from "./roles"

export interface Config {
  zaloBotToken: string
  webhookSecret: string
  kannaMcpUrl: string
  kannaPassword: string
  superadminIds: ReadonlySet<string>
  kannaDefaultDir: string
  userDirRoot?: string
  port: number
  webhookPath: string
  stateFile: string
  turnDeadlineSeconds: number
  progressPollSeconds: number
  progressUpdateSeconds: number
  progressTypingSeconds: number
  progressAck: boolean
  language: Language
}

export type Env = Readonly<Record<string, string | undefined>>

export class ConfigError extends Error {}

const REQUIRED_VARS = [
  "ZALO_BOT_TOKEN",
  "ZALO_WEBHOOK_SECRET",
  "KANNA_MCP_URL",
  "KANNA_PASSWORD",
  "ZALO_SUPERADMIN_IDS",
  "KANNA_DEFAULT_DIR",
] as const

const RENAMED_VARS = [
  { old: "ZALO_ALLOWED_USER_IDS", replacement: "ZALO_SUPERADMIN_IDS" },
  { old: "KANNA_PROJECT_ID", replacement: "KANNA_DEFAULT_DIR" },
] as const

const DIR_HINT = "must be an absolute path (/...) or start with ~/"

function present(env: Env, name: string): string | undefined {
  const value = env[name]?.trim()
  return value ? value : undefined
}

function positiveInt(env: Env, name: string, fallback: number, problems: string[]): number {
  const raw = present(env, name)
  if (raw === undefined) return fallback
  const parsed = Number(raw)
  if (!Number.isInteger(parsed) || parsed < 1) {
    problems.push(`${name} must be a positive integer`)
    return fallback
  }
  return parsed
}

function boundedInt(
  env: Env,
  name: string,
  range: { fallback: number; min: number; max: number },
  problems: string[],
): number {
  const raw = present(env, name)
  if (raw === undefined) return range.fallback
  const parsed = Number(raw)
  if (!Number.isInteger(parsed) || parsed < range.min || parsed > range.max) {
    problems.push(`${name} must be an integer from ${range.min} to ${range.max}`)
    return range.fallback
  }
  return parsed
}

function flag(env: Env, name: string, fallback: boolean, problems: string[]): boolean {
  const raw = present(env, name)?.toLowerCase()
  if (raw === undefined) return fallback
  if (raw === "true") return true
  if (raw === "false") return false
  problems.push(`${name} must be true or false`)
  return fallback
}

function language(env: Env, name: string, problems: string[]): Language {
  const raw = present(env, name)?.toLowerCase()
  if (raw === undefined) return "en"
  const match = LANGUAGES.find((candidate) => candidate === raw)
  if (match === undefined) {
    problems.push(`${name} must be one of ${LANGUAGES.join(", ")}`)
    return "en"
  }
  return match
}

export function parseConfig(env: Env): Config {
  const missing = REQUIRED_VARS.filter((name) => present(env, name) === undefined)
  const renamed = RENAMED_VARS.filter(
    ({ old, replacement }) => present(env, old) !== undefined && present(env, replacement) === undefined,
  ).map(({ old, replacement }) => `${old} was replaced by ${replacement}; set ${replacement} and remove ${old}`)
  if (missing.length > 0 || renamed.length > 0) {
    const parts: string[] = []
    if (missing.length > 0) parts.push(`Missing required environment variables: ${missing.join(", ")}`)
    parts.push(...renamed)
    throw new ConfigError(parts.join(". "))
  }

  const problems: string[] = []
  const webhookSecret = present(env, "ZALO_WEBHOOK_SECRET") ?? ""
  if (webhookSecret.length < 8 || webhookSecret.length > 256) {
    problems.push("ZALO_WEBHOOK_SECRET must be 8 to 256 characters")
  }

  const superadminIds = new Set(
    (present(env, "ZALO_SUPERADMIN_IDS") ?? "")
      .split(",")
      .map((id) => id.trim())
      .filter((id) => id.length > 0),
  )
  if (superadminIds.size === 0) {
    problems.push("ZALO_SUPERADMIN_IDS must list at least one Zalo user id")
  }

  const kannaDefaultDir = normalizeDir(present(env, "KANNA_DEFAULT_DIR") ?? "")
  if (kannaDefaultDir === undefined) problems.push(`KANNA_DEFAULT_DIR ${DIR_HINT}`)

  const rawRoot = present(env, "ZALO_USER_DIR_ROOT")
  const userDirRoot = rawRoot === undefined ? undefined : normalizeDir(rawRoot)
  if (rawRoot !== undefined && userDirRoot === undefined) problems.push(`ZALO_USER_DIR_ROOT ${DIR_HINT}`)

  const kannaMcpUrl = present(env, "KANNA_MCP_URL") ?? ""
  if (!URL.canParse(kannaMcpUrl)) {
    problems.push("KANNA_MCP_URL must be a valid URL")
  }

  const port = positiveInt(env, "PORT", 3000, problems)
  const turnDeadlineSeconds = positiveInt(env, "KANNA_TURN_DEADLINE_SECONDS", 1800, problems)

  const progressPollSeconds = boundedInt(env, "PROGRESS_POLL_SECONDS", { fallback: 15, min: 5, max: 90 }, problems)
  const progressUpdateSeconds = boundedInt(env, "PROGRESS_UPDATE_SECONDS", { fallback: 60, min: 15, max: 600 }, problems)
  const progressTypingSeconds = boundedInt(env, "PROGRESS_TYPING_SECONDS", { fallback: 5, min: 2, max: 30 }, problems)
  const progressAck = flag(env, "PROGRESS_ACK", true, problems)
  const bridgeLanguage = language(env, "BRIDGE_LANGUAGE", problems)

  const webhookPath = present(env, "WEBHOOK_PATH") ?? "/zalo/webhook"
  if (!webhookPath.startsWith("/")) {
    problems.push("WEBHOOK_PATH must start with /")
  }

  if (problems.length > 0) {
    throw new ConfigError(`Invalid configuration: ${problems.join("; ")}`)
  }

  return {
    zaloBotToken: present(env, "ZALO_BOT_TOKEN") ?? "",
    webhookSecret,
    kannaMcpUrl,
    kannaPassword: present(env, "KANNA_PASSWORD") ?? "",
    superadminIds,
    kannaDefaultDir: kannaDefaultDir ?? "",
    userDirRoot,
    port,
    webhookPath,
    stateFile: present(env, "STATE_FILE") ?? "./data/state.json",
    turnDeadlineSeconds,
    progressPollSeconds,
    progressUpdateSeconds,
    progressTypingSeconds,
    progressAck,
    language: bridgeLanguage,
  }
}
