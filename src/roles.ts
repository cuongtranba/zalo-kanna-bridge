import { posix } from "node:path"
import type { BridgeStore, UserRecord } from "./state"

export type SenderRole = { role: "superadmin" } | { role: "user"; record: UserRecord } | { role: "unknown" }

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/

export function normalizeDir(input: string): string | undefined {
  const trimmed = input.trim()
  if (CONTROL_CHARACTERS.test(trimmed)) return undefined
  if (!trimmed.startsWith("/") && !trimmed.startsWith("~/")) return undefined
  const normalized = posix.normalize(trimmed)
  const stripped = normalized.length > 1 && normalized.endsWith("/") ? normalized.slice(0, -1) : normalized
  return stripped.startsWith("/") || stripped.startsWith("~/") ? stripped : undefined
}

export function isInsideRoot(dir: string, root: string): boolean {
  if (dir === root) return true
  return dir.startsWith(root === "/" ? "/" : `${root}/`)
}

export function resolveSender(superadminIds: ReadonlySet<string>, store: BridgeStore, fromId: string): SenderRole {
  if (superadminIds.has(fromId)) return { role: "superadmin" }
  const record = store.getUser(fromId)
  return record === undefined ? { role: "unknown" } : { role: "user", record }
}
