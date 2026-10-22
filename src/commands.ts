import type { Messages, RoleName } from "./messages"

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

export function stripBotMention(text: string, botDisplayName: string | undefined): string {
  if (botDisplayName === undefined || botDisplayName === "") return text.trim()
  const escaped = `@${botDisplayName}`.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  return text.replace(new RegExp(`[ \\t]*${escaped}[ \\t]*`, "giu"), " ").trim()
}

export function parseCommand(text: string): ParsedCommand | undefined {
  const trimmed = text.trim()
  if (!trimmed.startsWith("/")) return undefined
  const [token = ""] = trimmed.split(/\s+/)
  const name = token.slice(1).toLowerCase()
  if (!SHARED_COMMANDS.has(name) && !ADMIN_COMMANDS.has(name)) return undefined
  return { name, rest: trimmed.slice(token.length).trim() }
}

export function helpText(messages: Messages, role: RoleName): string {
  const lines = role === "superadmin" ? [...messages.helpShared, ...messages.helpAdmin] : messages.helpShared
  return `${messages.helpHeading}\n${lines.join("\n")}\n\n${messages.helpFooter}`
}
