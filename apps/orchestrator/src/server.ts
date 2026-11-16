import { ConfigError, loadLlmConfig, loadServerConfig } from './config'
import { OpenAiCompatibleClient } from './llm/openai-compatible-client'
import { createApp } from './app'
import { logger } from './logger'

/**
 * Startup order matters: configuration is validated before the app is constructed, so a
 * missing key exits immediately naming the variable rather than becoming a 502 on the first
 * user request — a failure that would otherwise look like the provider's fault.
 */
function main(): void {
  let llmConfig
  let serverConfig

  try {
    llmConfig = loadLlmConfig()
    serverConfig = loadServerConfig()
  } catch (error) {
    if (error instanceof ConfigError) {
      console.error(`[config] ${error.message}`)
      process.exit(1)
    }
    throw error
  }

  const app = createApp(new OpenAiCompatibleClient(llmConfig))

  const server = app.listen(serverConfig.port, () => {
    logger.info('server.listening', { port: serverConfig.port, model: llmConfig.model })
  })

  /**
   * Graceful shutdown: stop accepting connections, then exit. The hard-exit timer is the
   * backstop — without it a hung keep-alive connection would hold the process open forever
   * and a deploy would have to be killed.
   */
  const shutdown = (signal: string): void => {
    logger.info('server.shutdown', { signal })
    server.close(() => process.exit(0))
    setTimeout(() => process.exit(1), 5_000).unref()
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.on('SIGINT', () => shutdown('SIGINT'))
}

main()
