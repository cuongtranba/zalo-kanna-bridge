import { existsSync, readFileSync } from "node:fs"
import { mkdir, rename, writeFile } from "node:fs/promises"
import { dirname } from "node:path"
import { isJsonObject, objectField, parseJson } from "./json"

export interface ChatMap {
  get(zaloChatId: string): string | undefined
  set(zaloChatId: string, kannaChatId: string): Promise<void>
  delete(zaloChatId: string): Promise<void>
}

function loadChats(path: string): Map<string, string> {
  const chats = new Map<string, string>()
  if (!existsSync(path)) return chats
  const parsed = parseJson(readFileSync(path, "utf8"))
  if (parsed === undefined || !isJsonObject(parsed)) {
    throw new Error(`State file ${path} is not valid JSON; fix or remove it`)
  }
  const stored = objectField(parsed, "chats")
  if (stored === undefined) return chats
  for (const [zaloChatId, kannaChatId] of Object.entries(stored)) {
    if (typeof kannaChatId === "string") chats.set(zaloChatId, kannaChatId)
  }
  return chats
}

export function createFileChatMap(path: string): ChatMap {
  const chats = loadChats(path)
  let writes: Promise<void> = Promise.resolve()

  async function persist(): Promise<void> {
    const body = JSON.stringify({ chats: Object.fromEntries(chats) }, null, 2)
    const tmp = `${path}.${process.pid}.tmp`
    await mkdir(dirname(path), { recursive: true })
    await writeFile(tmp, body, { mode: 0o600 })
    await rename(tmp, path)
  }

  function enqueuePersist(): Promise<void> {
    const next = writes.then(persist)
    writes = next.catch(() => undefined)
    return next
  }

  return {
    get: (zaloChatId) => chats.get(zaloChatId),
    set(zaloChatId, kannaChatId) {
      chats.set(zaloChatId, kannaChatId)
      return enqueuePersist()
    },
    delete(zaloChatId) {
      if (!chats.delete(zaloChatId)) return Promise.resolve()
      return enqueuePersist()
    },
  }
}
