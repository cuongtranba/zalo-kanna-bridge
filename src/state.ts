import { existsSync, readFileSync } from "node:fs"
import { mkdir, rename, writeFile } from "node:fs/promises"
import { dirname } from "node:path"
import { consoleLogger, type Logger } from "./log"
import { isJsonObject, numberField, objectField, parseJson, stringField, type JsonObject } from "./json"

export interface Conversation {
  kannaChatId: string
  projectId: string
}

export interface UserRecord {
  dir: string
  projectId: string
  name: string
  assignedBy: string
  assignedAt: number
}

export interface AdminRecord {
  dir?: string
  projectDir?: string
  projectId?: string
  chatId?: string
}

export interface SeenRecord {
  name: string
  lastSeen: number
  lastReplied?: number
}

export interface BridgeStore {
  getConversation(key: string): Conversation | undefined
  setConversation(key: string, conversation: Conversation): Promise<void>
  deleteConversation(key: string): Promise<void>
  getUser(zaloId: string): UserRecord | undefined
  listUsers(): [string, UserRecord][]
  setUser(zaloId: string, record: UserRecord): Promise<void>
  deleteUser(zaloId: string): Promise<boolean>
  getAdmin(zaloId: string): AdminRecord
  updateAdmin(zaloId: string, patch: AdminRecord): Promise<void>
  getSeen(zaloId: string): SeenRecord | undefined
  setSeen(zaloId: string, record: SeenRecord): Promise<void>
  listSeen(): [string, SeenRecord][]
}

interface StateData {
  conversations: Map<string, Conversation>
  users: Map<string, UserRecord>
  admins: Map<string, AdminRecord>
  seen: Map<string, SeenRecord>
}

const STATE_VERSION = 2
const SEEN_LIMIT = 200

function entries(parent: JsonObject, key: string): [string, JsonObject][] {
  const section = objectField(parent, key)
  if (section === undefined) return []
  const result: [string, JsonObject][] = []
  for (const [id, value] of Object.entries(section)) {
    if (isJsonObject(value)) result.push([id, value])
  }
  return result
}

function optionalString(object: JsonObject, key: string): { [name: string]: string } {
  const value = stringField(object, key)
  return value === undefined ? {} : { [key]: value }
}

function readVersionTwo(parsed: JsonObject): StateData {
  const data = emptyData()
  for (const [key, value] of entries(parsed, "conversations")) {
    const kannaChatId = stringField(value, "kannaChatId")
    const projectId = stringField(value, "projectId")
    if (kannaChatId !== undefined && projectId !== undefined) data.conversations.set(key, { kannaChatId, projectId })
  }
  for (const [id, value] of entries(parsed, "users")) {
    const dir = stringField(value, "dir")
    const projectId = stringField(value, "projectId")
    if (dir === undefined || projectId === undefined) continue
    data.users.set(id, {
      dir,
      projectId,
      name: stringField(value, "name") ?? id,
      assignedBy: stringField(value, "assignedBy") ?? "unknown",
      assignedAt: numberField(value, "assignedAt") ?? 0,
    })
  }
  for (const [id, value] of entries(parsed, "admins")) {
    data.admins.set(id, {
      ...optionalString(value, "dir"),
      ...optionalString(value, "projectDir"),
      ...optionalString(value, "projectId"),
      ...optionalString(value, "chatId"),
    })
  }
  for (const [id, value] of entries(parsed, "seen")) {
    const lastReplied = numberField(value, "lastReplied")
    data.seen.set(id, {
      name: stringField(value, "name") ?? id,
      lastSeen: numberField(value, "lastSeen") ?? 0,
      ...(lastReplied === undefined ? {} : { lastReplied }),
    })
  }
  return data
}

function emptyData(): StateData {
  return { conversations: new Map(), users: new Map(), admins: new Map(), seen: new Map() }
}

function loadState(path: string, log: Logger): StateData {
  if (!existsSync(path)) return emptyData()
  const parsed = parseJson(readFileSync(path, "utf8"))
  if (parsed === undefined || !isJsonObject(parsed)) {
    throw new Error(`State file ${path} is not valid JSON; fix or remove it`)
  }
  const version = numberField(parsed, "version") ?? 1
  if (version === STATE_VERSION) return readVersionTwo(parsed)
  if (version !== 1) throw new Error(`State file ${path} has unsupported version ${version}`)
  const dropped = Object.keys(objectField(parsed, "chats") ?? {}).length
  if (dropped > 0) {
    log.info(`state file ${path} is version 1; dropped ${dropped} old conversation(s) while migrating to version 2`)
  }
  return emptyData()
}

function serialize(data: StateData): string {
  return JSON.stringify(
    {
      version: STATE_VERSION,
      conversations: Object.fromEntries(data.conversations),
      users: Object.fromEntries(data.users),
      admins: Object.fromEntries(data.admins),
      seen: Object.fromEntries(data.seen),
    },
    null,
    2,
  )
}

export function createFileStore(path: string, log: Logger = consoleLogger): BridgeStore {
  const data = loadState(path, log)
  let writes: Promise<void> = Promise.resolve()

  async function persist(): Promise<void> {
    const tmp = `${path}.${process.pid}.tmp`
    await mkdir(dirname(path), { recursive: true })
    await writeFile(tmp, serialize(data), { mode: 0o600 })
    await rename(tmp, path)
  }

  function enqueuePersist(): Promise<void> {
    const next = writes.then(persist)
    writes = next.catch(() => undefined)
    return next
  }

  function pruneSeen(): void {
    if (data.seen.size <= SEEN_LIMIT) return
    const oldest = [...data.seen.entries()].sort((a, b) => a[1].lastSeen - b[1].lastSeen)[0]
    if (oldest !== undefined) data.seen.delete(oldest[0])
  }

  return {
    getConversation: (key) => data.conversations.get(key),
    setConversation(key, conversation) {
      data.conversations.set(key, conversation)
      return enqueuePersist()
    },
    deleteConversation(key) {
      if (!data.conversations.delete(key)) return Promise.resolve()
      return enqueuePersist()
    },
    getUser: (zaloId) => data.users.get(zaloId),
    listUsers: () => [...data.users.entries()],
    setUser(zaloId, record) {
      data.users.set(zaloId, record)
      return enqueuePersist()
    },
    async deleteUser(zaloId) {
      if (!data.users.delete(zaloId)) return false
      await enqueuePersist()
      return true
    },
    getAdmin: (zaloId) => data.admins.get(zaloId) ?? {},
    updateAdmin(zaloId, patch) {
      const current = data.admins.get(zaloId) ?? {}
      const next = { ...current, ...patch }
      if (JSON.stringify(next) === JSON.stringify(current)) return Promise.resolve()
      data.admins.set(zaloId, next)
      return enqueuePersist()
    },
    getSeen: (zaloId) => data.seen.get(zaloId),
    setSeen(zaloId, record) {
      data.seen.set(zaloId, record)
      pruneSeen()
      return enqueuePersist()
    },
    listSeen: () => [...data.seen.entries()],
  }
}
