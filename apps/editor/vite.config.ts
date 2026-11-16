/// <reference types="vitest" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: { port: 5180, strictPort: true },
  test: {
    // The contract's tests moved with it to `packages/schema`. The editor has no tests of
    // its own; `passWithNoTests` keeps `npm test` green here rather than failing on an
    // empty suite, which would train everyone to ignore a red test command.
    environment: 'node',
    include: ['src/**/*.test.ts'],
    passWithNoTests: true,
  },
})
