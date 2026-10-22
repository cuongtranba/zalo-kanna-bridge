import { errorMessage, isJsonObject } from "../src/json"
import { zaloCall } from "../src/zalo"

const url = process.argv[2]
const token = process.env["ZALO_BOT_TOKEN"]
const secret = process.env["ZALO_WEBHOOK_SECRET"]

if (url === undefined || !URL.canParse(url) || !url.startsWith("https://")) {
  console.error("usage: bun run scripts/set-webhook.ts https://public-host/zalo/webhook")
  process.exit(1)
}
if (!token || !secret) {
  console.error("ZALO_BOT_TOKEN and ZALO_WEBHOOK_SECRET must be set")
  process.exit(1)
}

try {
  const response = await zaloCall({ token }, "setWebhook", { url, secret_token: secret })
  const result = response["result"]
  const verification = isJsonObject(result) ? result["verification"] : undefined
  console.log(JSON.stringify(verification ?? null, null, 2))
} catch (error) {
  console.error(`setWebhook failed: ${errorMessage(error)}`)
  process.exit(1)
}
