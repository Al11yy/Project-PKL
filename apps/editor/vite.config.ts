/// <reference types="vitest" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5180,
    strictPort: true,
    /**
     * `/api` is proxied to the orchestrator so the browser talks to one origin.
     *
     * The orchestrator answers CORS preflights now, so this is no longer the only way to make
     * cross-origin calls work — but it is still the better default for dev. One origin means
     * no preflight on every request, and it sidesteps the case where the Worker's
     * `CORS_ALLOWED_ORIGINS` has not been updated for the port in use.
     *
     * Default is the Node dev server. Set `VITE_ORCHESTRATOR_URL` to the deployed Worker to
     * develop the editor against production data — the proxy follows the same variable the
     * client does, so the two can never point at different servers.
     */
    proxy: {
      '/api': {
        target: process.env.VITE_ORCHESTRATOR_URL ?? 'http://localhost:5181',
        changeOrigin: true,
      },
    },
  },
  test: {
    // The contract's tests moved with it to `packages/schema`. The editor has no tests of
    // its own; `passWithNoTests` keeps `npm test` green here rather than failing on an
    // empty suite, which would train everyone to ignore a red test command.
    environment: 'node',
    include: ['src/**/*.test.ts'],
    passWithNoTests: true,
  },
})
