import { expect, test } from "bun:test"
import { ConfigError, parseConfig } from "./index"

const validEnv = {
  ZALO_BOT_TOKEN: "test-token-123",
  ZALO_WEBHOOK_SECRET: "test-secret-123",
  KANNA_MCP_URL: "https://kanna.example.test/mcp",
  KANNA_PASSWORD: "test-password-123",
  KANNA_PROJECT_ID: "project-1",
  ZALO_ALLOWED_USER_IDS: "user-1",
}

test("config refuses an empty ZALO_ALLOWED_USER_IDS so the bridge never runs open", () => {
  expect(() => parseConfig({ ...validEnv, ZALO_ALLOWED_USER_IDS: "" })).toThrow(ConfigError)
  expect(() => parseConfig({ ...validEnv, ZALO_ALLOWED_USER_IDS: " , ," })).toThrow(/ZALO_ALLOWED_USER_IDS/)
})
