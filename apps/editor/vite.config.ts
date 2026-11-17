/// <reference types="vitest" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5180,
    strictPort: true,
    /**
     * `/api` is proxied to the orchestrator so the browser talks to one origin. Without this
     * every call would be cross-origin and the JSON `Content-Type` would trigger a preflight
     * the orchestrator does not answer, so the request would fail before reaching a route.
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
