import { expect, test } from "bun:test"
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js"
import { createServer, type Server } from "node:http"
import { z } from "zod"
import { createKannaMcpApi } from "./index"

const PASSWORD = "test-password-123"

function jsonText(value: object) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value) }] }
}

function buildMcpServer(): McpServer {
  const server = new McpServer({ name: "fake-kanna", version: "0.0.0" })
  server.registerTool(
    "send_message",
    {
      inputSchema: {
        chatId: z.string().optional(),
        projectId: z.string().optional(),
        content: z.string(),
        idempotencyKey: z.string().optional(),
        timeoutSeconds: z.number().optional(),
      },
    },
    async ({ chatId, projectId, content }) => {
      if (chatId === "missing") {
        return { isError: true, content: [{ type: "text" as const, text: "Chat missing was not found." }] }
      }
      return jsonText({
        chatId: chatId ?? `new-chat-in-${projectId}`,
        status: "running",
        busy: true,
        done: false,
        assistantText: `heard: ${content}`,
        cursor: 7,
        timedOut: true,
        pendingToolRequests: [],
        next: "call wait_for_chat",
      })
    },
  )
  server.registerTool(
    "wait_for_chat",
    { inputSchema: { chatId: z.string(), cursor: z.number().optional(), timeoutSeconds: z.number().optional() } },
    async ({ chatId, cursor }) =>
      jsonText({
        chatId,
        status: "idle",
        busy: false,
        done: true,
        assistantText: `resumed after ${cursor}`,
        cursor: 11,
        timedOut: false,
        pendingToolRequests: [],
        next: "reply to the user",
      }),
  )
  return server
}

function startFakeKanna(): Promise<Server> {
  const http = createServer(async (request, response) => {
    if (request.headers.authorization !== `Bearer ${PASSWORD}`) {
      response.writeHead(401).end("unauthorized")
      return
    }
    const mcp = buildMcpServer()
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined })
    response.on("close", () => {
      void transport.close()
      void mcp.close()
    })
    await mcp.connect(transport)
    await transport.handleRequest(request, response)
  })
  return new Promise((resolve) => http.listen(0, "127.0.0.1", () => resolve(http)))
}

test("the Kanna MCP adapter authenticates with the bearer password and parses tool results", async () => {
  const http = await startFakeKanna()
  const address = http.address()
  if (address === null || typeof address === "string") throw new Error("fake Kanna server has no port")
  const { port } = address
  const kanna = createKannaMcpApi({ url: `http://127.0.0.1:${port}/mcp`, password: PASSWORD })
  try {
    const sent = await kanna.sendMessage({
      projectId: "project-1",
      content: "hi",
      idempotencyKey: "zalo:m1",
      timeoutSeconds: 90,
    })
    const waited = await kanna.waitForChat({ chatId: "new-chat-in-project-1", cursor: 7, timeoutSeconds: 90 })
    const missing = await kanna.sendMessage({
      chatId: "missing",
      content: "hi",
      idempotencyKey: "zalo:m2",
      timeoutSeconds: 90,
    })

    expect(sent).toEqual({
      ok: true,
      value: {
        chatId: "new-chat-in-project-1",
        status: "running",
        busy: true,
        done: false,
        assistantText: "heard: hi",
        cursor: 7,
        timedOut: true,
        duplicate: false,
        queued: false,
      },
    })
    expect(waited.ok && waited.value.assistantText).toBe("resumed after 7")
    expect(missing).toEqual({ ok: false, error: "Chat missing was not found." })
  } finally {
    http.closeAllConnections()
    http.close()
  }
})
