import { createApp } from './app'
import { loadLlmConfig, type Env } from './config'
import { OpenAiCompatibleClient } from './llm/openai-compatible-client'

/**
 * Builds the request handler the Node dev server uses.
 *
 * Extracted from `server.ts` so it can be tested without binding a port.
 *
 * The reason this exists at all is a bug it now prevents: Hono's `app.fetch(request, env)` takes
 * bindings as its *second* argument, but `@hono/node-server` only ever passes the first. Wiring
 * `serve({ fetch: app.fetch })` therefore left `c.env` undefined on every request, and every
 * check that reads it — the shared-token gate, the generate flag, the D1 binding — silently did
 * nothing on the Node path while the Worker path behaved correctly. The unit tests did not
 * catch it because they call `app.fetch(request, env)` themselves, supplying what production
 * never did.
 *
 * Closing over `env` here makes the Node path structurally identical to the Worker path: one
 * handler, bindings always available.
 */
export function createNodeHandler(env: Env): (request: Request) => Promise<Response> {
  const llmConfig = loadLlmConfig(env)
  const app = createApp(new OpenAiCompatibleClient(llmConfig), llmConfig.timeoutMs)

  // `app.fetch` may return either synchronously or as a promise; the Node adapter's type wants
  // the promise form, so the result is wrapped rather than awaited.
  return async (request: Request) => app.fetch(request, env)
}
