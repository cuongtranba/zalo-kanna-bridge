import { createBridge } from "./bridge"
import { ConfigError, parseConfig } from "./config"
import { errorMessage } from "./json"
import { createKannaMcpApi } from "./kanna"
import { messagesFor } from "./messages"
import { createFileStore } from "./state"
import { createZaloApi, fetchBotDisplayName } from "./zalo"

function loadConfig() {
  try {
    return parseConfig(process.env)
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error
    console.error(`zalo-kanna-bridge: ${errorMessage(error)}`)
    process.exit(1)
  }
}

const config = loadConfig()

async function loadBotDisplayName(): Promise<string | undefined> {
  try {
    return await fetchBotDisplayName({ token: config.zaloBotToken })
  } catch (error) {
    console.warn(`zalo-kanna-bridge: could not read the bot name via getMe; @mentions will not be stripped: ${errorMessage(error)}`)
    return undefined
  }
}

const botDisplayName = await loadBotDisplayName()

const bridge = createBridge({
  config: { ...config, botDisplayName },
  kanna: createKannaMcpApi({ url: config.kannaMcpUrl, password: config.kannaPassword }),
  zalo: createZaloApi({ token: config.zaloBotToken }),
  store: createFileStore(config.stateFile),
  messages: messagesFor(config.language),
})

const server = Bun.serve({ port: config.port, fetch: (request) => bridge.fetch(request) })

console.log(
  `zalo-kanna-bridge listening on port ${server.port}; webhook ${config.webhookPath}; ` +
    `bot name ${botDisplayName ?? "unknown"}; ` +
    `${config.superadminIds.size} superadmin(s); Kanna at ${new URL(config.kannaMcpUrl).origin}`,
)

process.on("unhandledRejection", (reason) => {
  console.error(`unhandled rejection: ${errorMessage(reason)}`)
})
