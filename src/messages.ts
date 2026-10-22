export type Language = "en" | "vi"

export const LANGUAGES: readonly Language[] = ["en", "vi"]

export type RoleName = "superadmin" | "user"

export interface Messages {
  newConversation: string
  emptyReply: string
  waitingForAdmin: string
  waitingForYou: string
  waitingGeneric: string
  nothingWaiting: string
  turnFailed: string
  deadlineReached: string
  unreachable: string
  kannaError: string
  textOnly: string
  adminOnly: string
  received: string
  receivedInProject(title: string): string
  newSessionAfterIdle: string
  newConversationTip: string
  noAccess(zaloId: string): string
  stillWorking(tools: readonly string[]): string

  helpHeading: string
  helpShared: readonly string[]
  helpAdmin: readonly string[]
  helpFooter: string

  whoami(role: RoleName, zaloId: string, dir: string): string
  noDirectory: string
  currentDir(dir: string): string
  autoMode(defaultDir: string): string
  backToAuto(defaultDir: string): string
  usageAssign: string
  usageUnassign: string
  usageAnswer: string
  usageMcp: string
  usageApprove(zaloId: string): string
  mcpArgumentsNotObject(usage: string): string
  mcpError(error: string): string
  mcpTruncated: string
  waitingForReply(resolved: string): string

  waitingUserNotice(name: string, zaloId: string): string
  adminReplyHint(zaloId: string): string

  dirHelp: string
  userIdInvalid: string
  isSuperadmin(zaloId: string): string
  dirOutsideRoot(root: string): string
  couldNotOpen(dir: string, error: string): string
  assigned(name: string, zaloId: string, dir: string): string
  notAssigned(zaloId: string): string
  removed(name: string, zaloId: string): string
  dirChanged(dir: string): string
  assignedUsersHeading: string
  noUsersAssigned: string
  seenUsersHeading: string
  lastSeen(when: string): string

  directiveNotJson: string
  directiveUnknown(action: string | undefined): string
  directiveIgnored(error: string): string

  noQuestionText: string
  noPlanText: string
  questionLabel(text: string): string
  planApprovalNeeded(plan: string): string
  permissionNeeded(tool: string, input: string): string
  wrongQuestion: string
  wrongPlan(decision: string): string
  wrongPermission: string
  questionHasNoText: string
  answeredQuestion: string
  approvedPlan: string
  rejectedPlan: string
  approvedTool(tool: string): string
  deniedTool(tool: string): string
  cannotAnswerHere(tool: string): string
}

function toolList(tools: readonly string[]): string {
  return tools.length === 0 ? "" : ` (${tools.join(", ")})`
}

export const en: Messages = {
  newConversation: "Started a new Kanna conversation.",
  emptyReply: "(Kanna finished without a text reply.)",
  waitingForAdmin: "Waiting for an admin to approve a step.",
  waitingForYou: "Kanna is waiting for you. Reply /approve, /deny <reason> or /answer <text>.",
  waitingGeneric: "Kanna is waiting for a permission approval.",
  nothingWaiting: "Nothing is waiting for approval.",
  turnFailed: "The Kanna turn failed. Check the chat in Kanna.",
  deadlineReached: "Kanna is still working on this. Check the chat in Kanna.",
  unreachable: "Could not reach Kanna right now.",
  kannaError: "Kanna returned an error. Check the chat in Kanna.",
  textOnly: "Only text messages are supported for now.",
  adminOnly: "That command is for admins only.",
  received: "Got it, working on it…",
  receivedInProject: (title) => `Received, opening a session in ${title}…`,
  newSessionAfterIdle: "It has been a while, so I started a new session. (Send /new to start a new session any time.)",
  newConversationTip: "Tip: send /new any time to start a fresh session.",
  noAccess: (zaloId) =>
    `You don't have access to this bot yet. Your Zalo id is ${zaloId}. Ask an admin to give you access.`,
  stillWorking: (tools) => `Still working…${toolList(tools)}`,

  helpHeading: "Commands:",
  helpShared: [
    "/help - this list",
    "/whoami - your role, Zalo id and directory",
    "/new - start a fresh Kanna conversation",
  ],
  helpAdmin: [
    "/dir [path] - show or change your working directory (this turns automatic project choice off)",
    "/auto - let Kanna pick the project for each new session again",
    "#<project> <message> - open the session in that project (title match, case-insensitive)",
    "/assign <zaloId> <path> - give a user access to a directory",
    "/unassign <zaloId> - remove a user",
    "/users - assigned users and people who messaged the bot",
    "/approve [zaloId] - approve a waiting tool request",
    "/deny [zaloId] [reason] - deny a waiting request",
    "/answer [zaloId] <text> - answer a waiting question",
    "/mcp <tool> [json] - call any Kanna MCP tool",
  ],
  helpFooter: "Anything else is sent to the Kanna agent.",

  whoami: (role, zaloId, dir) => `Role: ${role}\nZalo id: ${zaloId}\nDirectory: ${dir}`,
  noDirectory: "none",
  currentDir: (dir) => `Current directory: ${dir}`,
  autoMode: (defaultDir) => `auto (Kanna picks the project for each new session; fallback ${defaultDir})`,
  backToAuto: (defaultDir) =>
    `Back to auto: Kanna picks the project for each new session, falling back to ${defaultDir}. Your next message starts a new Kanna conversation.`,
  usageAssign: "Usage: /assign <zaloId> <path>",
  usageUnassign: "Usage: /unassign <zaloId>",
  usageAnswer: "Usage: /answer [zaloId] <text>",
  usageMcp: "Usage: /mcp <tool> [json object]",
  usageApprove: (zaloId) => `No request from ${zaloId} is waiting. Usage: /approve [zaloId]`,
  mcpArgumentsNotObject: (usage) => `The arguments must be a JSON object. ${usage}`,
  mcpError: (error) => `Error: ${error}`,
  mcpTruncated: "...(truncated)",
  waitingForReply: (resolved) => `${resolved} Waiting for Kanna's reply.`,

  waitingUserNotice: (name, zaloId) => `${name} (${zaloId}) is waiting for approval.`,
  adminReplyHint: (zaloId) => `Reply /approve ${zaloId}, /deny ${zaloId} <reason> or /answer ${zaloId} <text>.`,

  dirHelp: "A path must be absolute (/...) or start with ~/.",
  userIdInvalid: "A Zalo user id cannot be empty or contain spaces.",
  isSuperadmin: (zaloId) => `${zaloId} is a superadmin and needs no assignment.`,
  dirOutsideRoot: (root) => `Users can only be assigned a directory inside ${root}.`,
  couldNotOpen: (dir, error) => `Kanna could not open ${dir}: ${error}`,
  assigned: (name, zaloId, dir) => `Assigned ${name} (${zaloId}) to ${dir}.`,
  notAssigned: (zaloId) => `${zaloId} is not an assigned user.`,
  removed: (name, zaloId) => `Removed ${name} (${zaloId}); they no longer have access.`,
  dirChanged: (dir) => `Your directory is now ${dir}. Your next message starts a new Kanna conversation there.`,
  assignedUsersHeading: "Assigned users:",
  noUsersAssigned: "No users are assigned yet.",
  seenUsersHeading: "Seen but not assigned (use /assign <id> <path>):",
  lastSeen: (when) => `last seen ${when}`,

  directiveNotJson: "the action is not valid JSON",
  directiveUnknown: (action) => `unknown action or missing fields (${action ?? "no action"})`,
  directiveIgnored: (error) => `Ignored an invalid ZALO_BRIDGE_ACTION: ${error}.`,

  noQuestionText: "(no question text)",
  noPlanText: "(no plan text)",
  questionLabel: (text) => `Question: ${text}`,
  planApprovalNeeded: (plan) => `Plan approval needed:\n${plan}`,
  permissionNeeded: (tool, input) => `Permission needed for ${tool}: ${input}`,
  wrongQuestion: "That is a question. Reply with /answer <text>.",
  wrongPlan: (decision) => `That is a plan. Reply with /approve or /deny <feedback> (not /${decision}).`,
  wrongPermission: "That is a tool permission. Reply with /approve or /deny <reason>.",
  questionHasNoText: "That question has no text to answer.",
  answeredQuestion: "Answered the question.",
  approvedPlan: "Approved the plan.",
  rejectedPlan: "Rejected the plan.",
  approvedTool: (tool) => `Approved ${tool}.`,
  deniedTool: (tool) => `Denied ${tool}.`,
  cannotAnswerHere: (tool) => `Cannot answer ${tool} from Zalo; answer it in Kanna.`,
}

export const vi: Messages = {
  newConversation: "Đã bắt đầu một cuộc trò chuyện mới với Kanna.",
  emptyReply: "(Kanna đã xong nhưng không có nội dung trả lời.)",
  waitingForAdmin: "Đang chờ quản trị viên duyệt một bước.",
  waitingForYou: "Kanna đang chờ bạn. Hãy trả lời /approve, /deny <lý do> hoặc /answer <nội dung>.",
  waitingGeneric: "Kanna đang chờ duyệt một quyền.",
  nothingWaiting: "Hiện không có yêu cầu nào đang chờ duyệt.",
  turnFailed: "Lượt xử lý của Kanna bị lỗi. Hãy xem cuộc trò chuyện trong Kanna.",
  deadlineReached: "Kanna vẫn đang xử lý việc này. Hãy xem cuộc trò chuyện trong Kanna.",
  unreachable: "Hiện chưa kết nối được tới Kanna.",
  kannaError: "Kanna báo lỗi. Hãy xem cuộc trò chuyện trong Kanna.",
  textOnly: "Hiện bot mới chỉ hỗ trợ tin nhắn văn bản.",
  adminOnly: "Lệnh này chỉ dành cho quản trị viên.",
  received: "Đã nhận, đang xử lý…",
  receivedInProject: (title) => `Đã nhận, mở phiên trong dự án ${title}…`,
  newSessionAfterIdle: "Đã lâu không nhắn nên mình bắt đầu phiên mới. (Gõ /new để tự bắt đầu phiên mới bất cứ lúc nào.)",
  newConversationTip: "Mẹo: gõ /new bất cứ lúc nào để bắt đầu phiên mới.",
  noAccess: (zaloId) =>
    `Bạn chưa có quyền dùng bot này. Zalo id của bạn là ${zaloId}. Hãy nhờ admin cấp quyền.`,
  stillWorking: (tools) => `Vẫn đang làm…${toolList(tools)}`,

  helpHeading: "Các lệnh:",
  helpShared: [
    "/help - danh sách lệnh này",
    "/whoami - vai trò, Zalo id và thư mục của bạn",
    "/new - bắt đầu cuộc trò chuyện mới với Kanna",
  ],
  helpAdmin: [
    "/dir [đường dẫn] - xem hoặc đổi thư mục làm việc của bạn (tắt chế độ tự chọn dự án)",
    "/auto - để Kanna tự chọn dự án cho mỗi phiên mới trở lại",
    "#<dự án> <nội dung> - mở phiên trong dự án đó (khớp đúng tên, không phân biệt hoa thường)",
    "/assign <zaloId> <đường dẫn> - cấp cho một người dùng quyền vào một thư mục",
    "/unassign <zaloId> - gỡ quyền của một người dùng",
    "/users - người dùng đã được cấp quyền và những người từng nhắn cho bot",
    "/approve [zaloId] - duyệt yêu cầu dùng công cụ đang chờ",
    "/deny [zaloId] [lý do] - từ chối yêu cầu đang chờ",
    "/answer [zaloId] <nội dung> - trả lời câu hỏi đang chờ",
    "/mcp <công cụ> [json] - gọi bất kỳ công cụ MCP nào của Kanna",
  ],
  helpFooter: "Mọi tin nhắn khác sẽ được gửi cho Kanna xử lý.",

  whoami: (role, zaloId, dir) =>
    `Vai trò: ${role === "superadmin" ? "quản trị viên (superadmin)" : "người dùng"}\nZalo id: ${zaloId}\nThư mục: ${dir}`,
  noDirectory: "chưa có",
  currentDir: (dir) => `Thư mục hiện tại: ${dir}`,
  autoMode: (defaultDir) => `tự động (Kanna chọn dự án cho mỗi phiên mới; mặc định ${defaultDir})`,
  backToAuto: (defaultDir) =>
    `Đã về chế độ tự động: Kanna chọn dự án cho mỗi phiên mới, nếu không rõ thì dùng ${defaultDir}. Tin nhắn tiếp theo sẽ bắt đầu cuộc trò chuyện mới với Kanna.`,
  usageAssign: "Cách dùng: /assign <zaloId> <đường dẫn>",
  usageUnassign: "Cách dùng: /unassign <zaloId>",
  usageAnswer: "Cách dùng: /answer [zaloId] <nội dung>",
  usageMcp: "Cách dùng: /mcp <công cụ> [đối tượng json]",
  usageApprove: (zaloId) => `Không có yêu cầu nào của ${zaloId} đang chờ. Cách dùng: /approve [zaloId]`,
  mcpArgumentsNotObject: (usage) => `Tham số phải là một đối tượng JSON. ${usage}`,
  mcpError: (error) => `Lỗi: ${error}`,
  mcpTruncated: "...(đã cắt bớt)",
  waitingForReply: (resolved) => `${resolved} Đang chờ Kanna trả lời.`,

  waitingUserNotice: (name, zaloId) => `${name} (${zaloId}) đang chờ được duyệt.`,
  adminReplyHint: (zaloId) =>
    `Hãy trả lời /approve ${zaloId}, /deny ${zaloId} <lý do> hoặc /answer ${zaloId} <nội dung>.`,

  dirHelp: "Đường dẫn phải là đường dẫn tuyệt đối (/...) hoặc bắt đầu bằng ~/.",
  userIdInvalid: "Zalo id của người dùng không được để trống hoặc chứa khoảng trắng.",
  isSuperadmin: (zaloId) => `${zaloId} là superadmin nên không cần cấp quyền.`,
  dirOutsideRoot: (root) => `Chỉ có thể cấp cho người dùng thư mục nằm trong ${root}.`,
  couldNotOpen: (dir, error) => `Kanna không mở được ${dir}: ${error}`,
  assigned: (name, zaloId, dir) => `Đã cấp cho ${name} (${zaloId}) quyền vào ${dir}.`,
  notAssigned: (zaloId) => `${zaloId} chưa được cấp quyền.`,
  removed: (name, zaloId) => `Đã gỡ ${name} (${zaloId}); người này không còn quyền truy cập.`,
  dirChanged: (dir) => `Thư mục của bạn giờ là ${dir}. Tin nhắn tiếp theo sẽ bắt đầu cuộc trò chuyện mới với Kanna tại đó.`,
  assignedUsersHeading: "Người dùng đã được cấp quyền:",
  noUsersAssigned: "Chưa có người dùng nào được cấp quyền.",
  seenUsersHeading: "Đã nhắn cho bot nhưng chưa được cấp quyền (dùng /assign <id> <đường dẫn>):",
  lastSeen: (when) => `lần cuối ${when}`,

  directiveNotJson: "hành động không phải JSON hợp lệ",
  directiveUnknown: (action) => `hành động không hợp lệ hoặc thiếu trường (${action ?? "không có hành động"})`,
  directiveIgnored: (error) => `Đã bỏ qua một ZALO_BRIDGE_ACTION không hợp lệ: ${error}.`,

  noQuestionText: "(câu hỏi không có nội dung)",
  noPlanText: "(kế hoạch không có nội dung)",
  questionLabel: (text) => `Câu hỏi: ${text}`,
  planApprovalNeeded: (plan) => `Cần duyệt kế hoạch:\n${plan}`,
  permissionNeeded: (tool, input) => `Cần cấp quyền cho ${tool}: ${input}`,
  wrongQuestion: "Đây là một câu hỏi. Hãy trả lời bằng /answer <nội dung>.",
  wrongPlan: (decision) => `Đây là một kế hoạch. Hãy trả lời bằng /approve hoặc /deny <góp ý> (không dùng /${decision}).`,
  wrongPermission: "Đây là yêu cầu cấp quyền cho công cụ. Hãy trả lời bằng /approve hoặc /deny <lý do>.",
  questionHasNoText: "Câu hỏi này không có nội dung để trả lời.",
  answeredQuestion: "Đã trả lời câu hỏi.",
  approvedPlan: "Đã duyệt kế hoạch.",
  rejectedPlan: "Đã từ chối kế hoạch.",
  approvedTool: (tool) => `Đã duyệt ${tool}.`,
  deniedTool: (tool) => `Đã từ chối ${tool}.`,
  cannotAnswerHere: (tool) => `Không thể trả lời ${tool} từ Zalo; hãy trả lời trong Kanna.`,
}

const TABLES: Record<Language, Messages> = { en, vi }

export function messagesFor(language: Language): Messages {
  return TABLES[language]
}

export const MESSAGES: Messages = en
