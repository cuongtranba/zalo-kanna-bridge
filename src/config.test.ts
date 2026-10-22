import { expect, test } from "bun:test"
import { ConfigError, parseConfig } from "./index"

const validEnv = {
  ZALO_BOT_TOKEN: "test-token-123",
  ZALO_WEBHOOK_SECRET: "test-secret-123",
  KANNA_MCP_URL: "https://kanna.example.test/mcp",
  KANNA_PASSWORD: "test-password-123",
  ZALO_SUPERADMIN_IDS: "admin-1, admin-2",
  KANNA_DEFAULT_DIR: "/Users/me/Kanna/stuff",
}

test("config refuses a missing or empty ZALO_SUPERADMIN_IDS so the bridge never runs without an owner", () => {
  const { ZALO_SUPERADMIN_IDS: _removed, ...withoutAdmins } = validEnv
  expect(() => parseConfig(withoutAdmins)).toThrow(/ZALO_SUPERADMIN_IDS/)
  expect(() => parseConfig({ ...validEnv, ZALO_SUPERADMIN_IDS: " , ," })).toThrow(ConfigError)
})

test("config that only sets an old variable fails with a message naming its replacement", () => {
  const { ZALO_SUPERADMIN_IDS: _a, KANNA_DEFAULT_DIR: _d, ...rest } = validEnv
  expect(() => parseConfig({ ...rest, ZALO_ALLOWED_USER_IDS: "old", KANNA_DEFAULT_DIR: validEnv.KANNA_DEFAULT_DIR })).toThrow(
    /ZALO_ALLOWED_USER_IDS was replaced by ZALO_SUPERADMIN_IDS/,
  )
  expect(() => parseConfig({ ...rest, ZALO_SUPERADMIN_IDS: "admin-1", KANNA_PROJECT_ID: "old" })).toThrow(
    /KANNA_PROJECT_ID was replaced by KANNA_DEFAULT_DIR/,
  )
})

test("config reads superadmin ids and a normalised optional user directory root", () => {
  const config = parseConfig({ ...validEnv, ZALO_USER_DIR_ROOT: "~/Kanna/users/" })

  expect([...config.superadminIds]).toEqual(["admin-1", "admin-2"])
  expect(config.kannaDefaultDir).toBe("/Users/me/Kanna/stuff")
  expect(config.userDirRoot).toBe("~/Kanna/users")
  expect(() => parseConfig({ ...validEnv, ZALO_USER_DIR_ROOT: "relative/path" })).toThrow(/ZALO_USER_DIR_ROOT/)
})

test("BRIDGE_LANGUAGE accepts vi and refuses an unknown language", () => {
  expect(parseConfig({ ...validEnv, BRIDGE_LANGUAGE: "vi" }).language).toBe("vi")
  expect(parseConfig(validEnv).language).toBe("en")
  expect(() => parseConfig({ ...validEnv, BRIDGE_LANGUAGE: "fr" })).toThrow(/BRIDGE_LANGUAGE/)
})

test("SESSION_IDLE_MINUTES defaults to 30, accepts 0 to disable and refuses values outside 0..10080", () => {
  expect(parseConfig(validEnv).sessionIdleMinutes).toBe(30)
  expect(parseConfig({ ...validEnv, SESSION_IDLE_MINUTES: "0" }).sessionIdleMinutes).toBe(0)
  expect(() => parseConfig({ ...validEnv, SESSION_IDLE_MINUTES: "10081" })).toThrow(/SESSION_IDLE_MINUTES/)
  expect(() => parseConfig({ ...validEnv, SESSION_IDLE_MINUTES: "-1" })).toThrow(/SESSION_IDLE_MINUTES/)
})
