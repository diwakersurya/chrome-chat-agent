import { defineConfig } from 'vitest/config'

export default defineConfig({
  define: { __TARGET__: JSON.stringify('web') },
  test: { include: ['src/**/*.test.ts'] },
})
