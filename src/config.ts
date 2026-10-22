export interface Config {
  zaloBotToken: string
  webhookSecret: string
  kannaMcpUrl: string
  kannaPassword: string
  kannaProjectId: string
  allowedUserIds: ReadonlySet<string>
  port: number
  webhookPath: string
  stateFile: string
  turnDeadlineSeconds: number
}

export type Env = Readonly<Record<string, string | undefined>>

export class ConfigError extends Error {}

const REQUIRED_VARS = [
  "ZALO_BOT_TOKEN",
  "ZALO_WEBHOOK_SECRET",
  "KANNA_MCP_URL",
  "KANNA_PASSWORD",
  "KANNA_PROJECT_ID",
  "ZALO_ALLOWED_USER_IDS",
] as const

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

export function parseConfig(env: Env): Config {
  const missing = REQUIRED_VARS.filter((name) => present(env, name) === undefined)
  if (missing.length > 0) {
    throw new ConfigError(`Missing required environment variables: ${missing.join(", ")}`)
  }

  const problems: string[] = []
  const webhookSecret = present(env, "ZALO_WEBHOOK_SECRET") ?? ""
  if (webhookSecret.length < 8 || webhookSecret.length > 256) {
    problems.push("ZALO_WEBHOOK_SECRET must be 8 to 256 characters")
  }

  const allowedUserIds = new Set(
    (present(env, "ZALO_ALLOWED_USER_IDS") ?? "")
      .split(",")
      .map((id) => id.trim())
      .filter((id) => id.length > 0),
  )
  if (allowedUserIds.size === 0) {
    problems.push("ZALO_ALLOWED_USER_IDS must list at least one Zalo user id")
  }

  const kannaMcpUrl = present(env, "KANNA_MCP_URL") ?? ""
  if (!URL.canParse(kannaMcpUrl)) {
    problems.push("KANNA_MCP_URL must be a valid URL")
  }

  const port = positiveInt(env, "PORT", 3000, problems)
  const turnDeadlineSeconds = positiveInt(env, "KANNA_TURN_DEADLINE_SECONDS", 1800, problems)

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
    kannaProjectId: present(env, "KANNA_PROJECT_ID") ?? "",
    allowedUserIds,
    port,
    webhookPath,
    stateFile: present(env, "STATE_FILE") ?? "./data/state.json",
    turnDeadlineSeconds,
  }
}
