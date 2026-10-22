export interface ParsedCommand {
  name: string
  rest: string
}

export const ADMIN_COMMANDS: ReadonlySet<string> = new Set([
  "dir",
  "assign",
  "unassign",
  "users",
  "approve",
  "deny",
  "answer",
  "mcp",
])

const SHARED_COMMANDS: ReadonlySet<string> = new Set(["help", "whoami", "new"])

export function parseCommand(text: string): ParsedCommand | undefined {
  const trimmed = text.trim()
  if (!trimmed.startsWith("/")) return undefined
  const [token = ""] = trimmed.split(/\s+/)
  const name = token.slice(1).toLowerCase()
  if (!SHARED_COMMANDS.has(name) && !ADMIN_COMMANDS.has(name)) return undefined
  return { name, rest: trimmed.slice(token.length).trim() }
}

const SHARED_HELP = [
  "/help - this list",
  "/whoami - your role, Zalo id and directory",
  "/new - start a fresh Kanna conversation",
]

const ADMIN_HELP = [
  "/dir [path] - show or change your working directory",
  "/assign <zaloId> <path> - give a user access to a directory",
  "/unassign <zaloId> - remove a user",
  "/users - assigned users and people who messaged the bot",
  "/approve [zaloId] - approve a waiting tool request",
  "/deny [zaloId] [reason] - deny a waiting request",
  "/answer [zaloId] <text> - answer a waiting question",
  "/mcp <tool> [json] - call any Kanna MCP tool",
]

export function helpText(role: "superadmin" | "user"): string {
  const lines = role === "superadmin" ? [...SHARED_HELP, ...ADMIN_HELP] : SHARED_HELP
  return `Commands:\n${lines.join("\n")}\n\nAnything else is sent to the Kanna agent.`
}
