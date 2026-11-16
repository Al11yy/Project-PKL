/// <reference types="vitest" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: { port: 5180, strictPort: true },
  test: {
    // The contract is pure data logic, so it must be testable without a DOM.
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
