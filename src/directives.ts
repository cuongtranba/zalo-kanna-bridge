import type { AdminOps, OpResult } from "./admin"
import { isJsonObject, parseJson, stringField } from "./json"

export type Directive =
  | { action: "assign"; userId: string; dir: string }
  | { action: "unassign"; userId: string }
  | { action: "set_dir"; dir: string }

export type ParsedDirective = { ok: true; directive: Directive } | { ok: false; error: string }

export const DIRECTIVE_PREFIX = "ZALO_BRIDGE_ACTION"

const DIRECTIVE_LINE = /^\s*ZALO_BRIDGE_ACTION\s+(\{.*\})\s*$/

function parseDirective(json: string): ParsedDirective {
  const parsed = parseJson(json)
  if (parsed === undefined || !isJsonObject(parsed)) return { ok: false, error: "the action is not valid JSON" }
  const action = stringField(parsed, "action")
  const userId = stringField(parsed, "userId")
  const dir = stringField(parsed, "dir")
  if (action === "assign" && userId !== undefined && dir !== undefined) {
    return { ok: true, directive: { action, userId, dir } }
  }
  if (action === "unassign" && userId !== undefined) return { ok: true, directive: { action, userId } }
  if (action === "set_dir" && dir !== undefined) return { ok: true, directive: { action, dir } }
  return { ok: false, error: `unknown action or missing fields (${action ?? "no action"})` }
}

export function extractDirectives(text: string): { text: string; directives: ParsedDirective[] } {
  const kept: string[] = []
  const directives: ParsedDirective[] = []
  for (const line of text.split("\n")) {
    const match = DIRECTIVE_LINE.exec(line)
    if (match?.[1] === undefined) {
      kept.push(line)
    } else {
      directives.push(parseDirective(match[1]))
    }
  }
  return { text: kept.join("\n").trim(), directives }
}

export async function runDirective(ops: AdminOps, adminId: string, parsed: ParsedDirective): Promise<OpResult> {
  if (!parsed.ok) return { ok: false, text: `Ignored an invalid ${DIRECTIVE_PREFIX}: ${parsed.error}.` }
  const { directive } = parsed
  switch (directive.action) {
    case "assign":
      return ops.assign(adminId, directive.userId, directive.dir)
    case "unassign":
      return ops.unassign(directive.userId)
    case "set_dir":
      return ops.setDir(adminId, directive.dir)
  }
}
