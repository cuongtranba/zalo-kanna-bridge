import type { BridgeConfig } from "./bridge"
import type { KannaApi, KannaOutcome } from "./kanna"
import { isInsideRoot, normalizeDir } from "./roles"
import type { BridgeStore } from "./state"

export interface OpResult {
  ok: boolean
  text: string
}

export interface Workspace {
  dir: string
  projectId: string
}

export interface AdminOps {
  assign(adminId: string, userId: string, dirInput: string): Promise<OpResult>
  unassign(userId: string): Promise<OpResult>
  setDir(adminId: string, dirInput: string): Promise<OpResult>
  currentDir(adminId: string): string
  workspaceFor(role: "superadmin" | "user", zaloId: string): Promise<KannaOutcome<Workspace>>
  describeUsers(): string
  knownUsers(limit: number): string
}

export interface AdminOpsDeps {
  config: Pick<BridgeConfig, "superadminIds" | "kannaDefaultDir" | "userDirRoot">
  kanna: KannaApi
  store: BridgeStore
  now: () => number
}

const DIR_HELP = "A path must be absolute (/...) or start with ~/."
const SEEN_LISTED = 20

function fail(text: string): OpResult {
  return { ok: false, text }
}

function when(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 16).replace("T", " ") + "Z"
}

export function createAdminOps(deps: AdminOpsDeps): AdminOps {
  const { config, kanna, store, now } = deps

  function unassignedSeen(): [string, { name: string; lastSeen: number }][] {
    return store
      .listSeen()
      .filter(([id]) => store.getUser(id) === undefined && !config.superadminIds.has(id))
      .sort((a, b) => b[1].lastSeen - a[1].lastSeen)
  }

  function currentDir(adminId: string): string {
    return store.getAdmin(adminId).dir ?? config.kannaDefaultDir
  }

  async function workspaceForAdmin(adminId: string): Promise<KannaOutcome<Workspace>> {
    const dir = currentDir(adminId)
    const admin = store.getAdmin(adminId)
    if (admin.projectDir === dir && admin.projectId !== undefined) {
      return { ok: true, value: { dir, projectId: admin.projectId } }
    }
    const opened = await kanna.openProject(dir)
    if (!opened.ok) return { ok: false, error: `Kanna could not open ${dir}: ${opened.error}` }
    await store.updateAdmin(adminId, { projectDir: dir, projectId: opened.value })
    return { ok: true, value: { dir, projectId: opened.value } }
  }

  return {
    currentDir,
    async workspaceFor(role, zaloId) {
      if (role === "superadmin") return workspaceForAdmin(zaloId)
      const user = store.getUser(zaloId)
      if (user === undefined) return { ok: false, error: `Zalo user ${zaloId} is no longer assigned` }
      return { ok: true, value: { dir: user.dir, projectId: user.projectId } }
    },
    async assign(adminId, userId, dirInput) {
      if (!/^\S+$/.test(userId)) return fail("A Zalo user id cannot be empty or contain spaces.")
      if (config.superadminIds.has(userId)) return fail(`${userId} is a superadmin and needs no assignment.`)
      const dir = normalizeDir(dirInput)
      if (dir === undefined) return fail(DIR_HELP)
      if (config.userDirRoot !== undefined && !isInsideRoot(dir, config.userDirRoot)) {
        return fail(`Users can only be assigned a directory inside ${config.userDirRoot}.`)
      }
      const opened = await kanna.openProject(dir)
      if (!opened.ok) return fail(`Kanna could not open ${dir}: ${opened.error}`)
      const name = store.getUser(userId)?.name ?? store.getSeen(userId)?.name ?? userId
      await store.setUser(userId, { dir, projectId: opened.value, name, assignedBy: adminId, assignedAt: now() })
      return { ok: true, text: `Assigned ${name} (${userId}) to ${dir}.` }
    },
    async unassign(userId) {
      const user = store.getUser(userId)
      if (user === undefined) return fail(`${userId} is not an assigned user.`)
      await store.deleteUser(userId)
      return { ok: true, text: `Removed ${user.name} (${userId}); they no longer have access.` }
    },
    async setDir(adminId, dirInput) {
      const dir = normalizeDir(dirInput)
      if (dir === undefined) return fail(DIR_HELP)
      const opened = await kanna.openProject(dir)
      if (!opened.ok) return fail(`Kanna could not open ${dir}: ${opened.error}`)
      await store.updateAdmin(adminId, { dir, projectDir: dir, projectId: opened.value })
      return { ok: true, text: `Your directory is now ${dir}. Your next message starts a new Kanna conversation there.` }
    },
    describeUsers() {
      const assigned = store.listUsers().map(([id, user]) => `- ${user.name} (${id}) -> ${user.dir}`)
      const seen = unassignedSeen()
        .slice(0, SEEN_LISTED)
        .map(([id, entry]) => `- ${entry.name} (${id}), last seen ${when(entry.lastSeen)}`)
      return [
        assigned.length > 0 ? `Assigned users:\n${assigned.join("\n")}` : "No users are assigned yet.",
        seen.length > 0 ? `Seen but not assigned (use /assign <id> <path>):\n${seen.join("\n")}` : "",
      ]
        .filter((part) => part.length > 0)
        .join("\n\n")
    },
    knownUsers(limit) {
      const assigned = store.listUsers().map(([id, user]) => `${id}=${user.name}->${user.dir}`)
      const seen = unassignedSeen().map(([id, entry]) => `${id}=${entry.name} (unassigned)`)
      const all = [...assigned, ...seen]
      return all.length === 0 ? "none" : all.slice(0, limit).join("; ")
    },
  }
}
