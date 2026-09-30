import { defineConfig } from 'vite'
import { shared } from './vite.shared'

export default defineConfig({
  ...shared('web'),
  // GitHub Pages serves from /<repo>/
  base: process.env.PAGES_BASE ?? './',
  build: { ...shared('web').build, outDir: 'dist/web' },
})
