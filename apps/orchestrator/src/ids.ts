/**
 * Id and hash generation, on Web Crypto only.
 *
 * This file used `node:crypto`. Both callers now use the global `crypto` object, which exists
 * unchanged in Node 20+, every current browser, and workerd — so the same module runs on the
 * Worker and in the Node dev server with no conditional import and no `nodejs_compat` flag.
 *
 * `crypto.subtle` is asynchronous while `createHash` was not, so `promptHash` is now async.
 * That is the one place this table's signature changed; its callers already sat inside async
 * functions, so no call site had to be restructured around it.
 */

/**
 * Server-generated project id.
 *
 * Generated here rather than accepted from the model because a model-supplied id is
 * indistinguishable from a real one once it is in React state — the exact confusion
 * `llmProjectSchema` exists to prevent.
 *
 * The `p-` prefix must satisfy `idSchema` in `@rakit/schema` (`^[A-Za-z0-9_.:-]+$`, max 64
 * characters). A UUID's hyphens are allowed by that pattern, and the prefix keeps a
 * generated id recognisable in a log or a seed file.
 */
export const projectId = (): string => `p-${crypto.randomUUID()}`

/**
 * Short correlation id for logs.
 *
 * Eight hex characters: enough to follow one request through a log, not a security token.
 * Never used for authorisation or as a project identifier.
 */
export const requestId = (): string => crypto.randomUUID().slice(0, 8)

/**
 * Stable short hash of a prompt, for correlating a validation failure with the input that
 * produced it.
 *
 * M-5 requires the prompt hash in the warn line, and a hash rather than the prompt is the
 * point: the prompt is the user's business text. Twelve hex characters is enough to group
 * identical prompts in a log without being a way to read them back.
 *
 * `sha256` rather than a fast non-cryptographic hash so that a hash of a short, guessable
 * prompt cannot be reversed by brute force — "kasir" has few enough variants that a weak
 * hash would be a redaction in name only.
 */
export const promptHash = async (prompt: string): Promise<string> => {
  const bytes = new TextEncoder().encode(prompt)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 12)
}
