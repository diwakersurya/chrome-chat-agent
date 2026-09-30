import { defineConfig } from 'vite'
import { crx } from '@crxjs/vite-plugin'
import { shared } from './vite.shared'
import manifest from './manifest.config'

const base = shared('ext')

export default defineConfig({
  ...base,
  plugins: [...(base.plugins ?? []), crx({ manifest })],
  build: { ...base.build, outDir: 'dist/ext' },
  server: { cors: { origin: [/chrome-extension:\/\//] } },
})
