import { createBridge } from "./bridge"
import { ConfigError, parseConfig } from "./config"
import { errorMessage } from "./json"
import { createKannaMcpApi } from "./kanna"
import { createFileStore } from "./state"
import { createZaloApi } from "./zalo"

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

const bridge = createBridge({
  config,
  kanna: createKannaMcpApi({ url: config.kannaMcpUrl, password: config.kannaPassword }),
  zalo: createZaloApi({ token: config.zaloBotToken }),
  store: createFileStore(config.stateFile),
})

const server = Bun.serve({ port: config.port, fetch: (request) => bridge.fetch(request) })

console.log(
  `zalo-kanna-bridge listening on port ${server.port}; webhook ${config.webhookPath}; ` +
    `${config.superadminIds.size} superadmin(s); Kanna at ${new URL(config.kannaMcpUrl).origin}`,
)

process.on("unhandledRejection", (reason) => {
  console.error(`unhandled rejection: ${errorMessage(reason)}`)
})
