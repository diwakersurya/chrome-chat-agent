import { defineConfig, type Plugin } from 'vite'
import { shared } from './vite.shared'

// Production CSP (dev needs Vite's inline HMR scripts). Images and media stay
// local so model output can't exfiltrate chat text through a remote <img>;
// connect-src stays open for user-configured MCP servers.
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "media-src 'self' data: blob:",
  "worker-src 'self' blob:",
  'connect-src * data: blob:',
  "object-src 'none'",
  "base-uri 'self'",
].join('; ')

const csp = (): Plugin => ({
  name: 'csp-meta',
  apply: 'build',
  transformIndexHtml: (html) =>
    html.replace('<meta charset="UTF-8" />', `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`),
})

const base = shared('web')

export default defineConfig({
  ...base,
  plugins: [...(base.plugins ?? []), csp()],
  // GitHub Pages serves from /<repo>/
  base: process.env.PAGES_BASE ?? './',
  build: { ...base.build, outDir: 'dist/web' },
})
