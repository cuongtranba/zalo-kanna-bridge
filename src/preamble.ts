import { DIRECTIVE_PREFIX } from "./directives"

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]+/g

function plain(text: string): string {
  return text.replace(CONTROL_CHARACTERS, " ").trim()
}

export function userPreamble(name: string, dir: string, message: string): string {
  return (
    `[Zalo bridge] You are working for a restricted Zalo user (${plain(name)}). ` +
    `Only read and change files inside ${dir}. Do not access or reveal anything outside it.\n\n${message}`
  )
}

export function adminPreamble(name: string, knownUsers: string, message: string): string {
  const example = `${DIRECTIVE_PREFIX} {"action":"assign","userId":"<zaloId>","dir":"<absolute path>"}`
  return (
    `[Zalo bridge] Message from superadmin ${plain(name)} via Zalo. ` +
    `You can manage Zalo bot users: to act, put one line per action in your reply exactly like \`${example}\` ` +
    `(actions: assign {userId, dir}, unassign {userId}, set_dir {dir} for the superadmin's own dir). ` +
    `Known users: ${knownUsers}.\n\n${message}`
  )
}
